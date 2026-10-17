import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Annotation } from "../shared/annotations.ts";
import { isPageId, PAGES, type CompareLayout, type NavSection, type PageId, type ReviewView } from "../shared/frame.ts";
import { useBridge } from "./bridge.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { CHAT_DEFAULT_WIDTH, ChatResizer, clampChatWidth } from "./shell/ChatResizer.tsx";
import { CreateDialog } from "./shell/CreateDialog.tsx";
import { ExportDialog } from "./shell/ExportDialog.tsx";
import { HistoryMenu } from "./shell/HistoryMenu.tsx";
import { InspectBanner } from "./shell/InspectBanner.tsx";
import { PreviewFrame, type PreviewFrameHandle } from "./shell/PreviewFrame.tsx";
import { ReviewBar } from "./shell/ReviewBar.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import styles from "./shell/Shell.module.css";

type Theme = "light" | "dark";

/** Per-viewer UI preferences. Storage can be unavailable (private mode); the app then just uses defaults. */
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`basis:${key}`);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`basis:${key}`, value);
  } catch {
    // Preference only lasts for this visit.
  }
}

function initialChatWidth(): number {
  const stored = Number(readPref("chat-width"));
  return clampChatWidth(Number.isFinite(stored) && stored > 0 ? stored : CHAT_DEFAULT_WIDTH);
}

export function App() {
  const { state, send } = useBridge();
  const [theme, setTheme] = useState<Theme>(() => (readPref("theme") === "dark" ? "dark" : "light"));
  const [chatWidth, setChatWidth] = useState(initialChatWidth);
  const [chatHidden, setChatHidden] = useState(() => readPref("chat-hidden") === "true");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readPref("sidebar-collapsed") === "true");
  const [page, setPage] = useState<PageId>(() => {
    const stored = readPref("page");
    return isPageId(stored) ? stored : "system";
  });
  // The unsent message survives a reload.
  const [draft, setDraft] = useState(() => readPref("draft") ?? "");
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [picking, setPicking] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [reviewLayout, setReviewLayout] = useState<CompareLayout>(() =>
    readPref("review-layout") === "stacked" ? "stacked" : "split",
  );
  /** True while the user looks at the gallery instead of the open review. */
  const [reviewHidden, setReviewHidden] = useState(false);
  /** Sections outside the review that changed, as the preview reports them, and the ones the user opened. */
  const [impact, setImpact] = useState<string[]>([]);
  const [peeks, setPeeks] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<string>();
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [sections, setSections] = useState<NavSection[]>([]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<PreviewFrameHandle>(null);
  const live = state.design?.design;

  const history = state.history;
  const inspectIndex = inspectId ? history.findIndex((entry) => entry.id === inspectId) : -1;
  const inspectEntry = inspectIndex >= 0 ? history[inspectIndex] : undefined;
  const snapshot = inspectId ? state.snapshots[inspectId] : undefined;
  const design = inspectEntry ? (snapshot?.design ?? live) : live;

  useEffect(() => writePref("theme", theme), [theme]);
  useEffect(() => writePref("chat-width", String(chatWidth)), [chatWidth]);
  useEffect(() => writePref("chat-hidden", String(chatHidden)), [chatHidden]);
  useEffect(() => writePref("sidebar-collapsed", String(sidebarCollapsed)), [sidebarCollapsed]);
  useEffect(() => writePref("page", page), [page]);
  useEffect(() => writePref("review-layout", reviewLayout), [reviewLayout]);
  useEffect(() => {
    const timer = setTimeout(() => writePref("draft", draft), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  // Keep the stored width valid when the window shrinks.
  useEffect(() => {
    const onResize = () => setChatWidth((width) => clampChatWidth(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Ctrl/Cmd+B toggles the chat, like a sidebar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setChatHidden((hidden) => !hidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The agent is blocked until a permission is answered, so bring the chat back for it.
  const pendingPermission = state.chat.some((item) => item.kind === "permission" && !item.resolved);
  useEffect(() => {
    if (pendingPermission) setChatHidden(false);
  }, [pendingPermission]);

  useEffect(() => {
    if (inspectId && !state.snapshots[inspectId]) send({ type: "snapshot-get", id: inspectId });
  }, [inspectId, state.snapshots, send]);

  // The open review: its starting point is fetched once, and the review comes into view whenever the agent
  // opens it or records a new iteration, since that is when it has something to show.
  const review = state.review;
  const baselineId = review?.baseline;
  const baseline = baselineId ? state.baselines[baselineId] : undefined;
  useEffect(() => {
    if (baselineId && !baseline) send({ type: "baseline-get", id: baselineId });
  }, [baselineId, baseline, send]);

  const stepCount = review?.steps.length ?? 0;
  useEffect(() => {
    if (!baselineId) return;
    setReviewHidden(false);
    setInspectId(null);
  }, [baselineId, stepCount]);

  useEffect(() => {
    setImpact([]);
    setPeeks([]);
  }, [baselineId]);

  const reviewView = useMemo<ReviewView | null>(
    () =>
      review && !reviewHidden
        ? {
            title: review.title,
            targets: [...review.show, ...peeks.map((id) => ({ specimen: id, peek: true }))],
            layout: reviewLayout,
            baseline: baseline ? { design: baseline.design, base: baseline.base } : null,
          }
        : null,
    [review, reviewHidden, peeks, reviewLayout, baseline],
  );
  // Opened sections stay listed: the preview stops checking what the review already shows.
  const listed = new Set([...impact, ...peeks]);
  const impactSections = sections.filter((section) => listed.has(section.id));

  // Stop inspecting if the entry is pruned from history.
  useEffect(() => {
    if (inspectId && !history.some((entry) => entry.id === inspectId)) setInspectId(null);
  }, [history, inspectId]);

  const focusComposer = useCallback(() => {
    setChatHidden(false);
    requestAnimationFrame(() => {
      const el = composer.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const ask = useCallback(
    (prefix: string) => {
      setDraft((current) => (current.trim() ? `${current.trimEnd()}\n${prefix}` : prefix));
      focusComposer();
    },
    [focusComposer],
  );

  // The server folds what the preview fails to render into the agent's fix loop.
  useEffect(() => {
    if (state.connected) send({ type: "preview-errors", errors: previewErrors });
  }, [previewErrors, state.connected, send]);

  // Esc ends pick mode even when focus is outside the preview.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPicking(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const problems = [
    ...(state.design?.errors ?? []).map((error) => `design-system.json: ${error}`),
    ...(state.design?.typeErrors ?? []),
    ...(state.design?.reviewErrors ?? []),
    ...previewErrors,
  ];

  const finishPicking = useCallback(() => {
    setPicking(false);
    focusComposer();
  }, [focusComposer]);

  const step = (direction: -1 | 1) => {
    const next = history[inspectIndex + direction];
    setInspectId(next && inspectIndex + direction < history.length - 1 ? next.id : null);
  };

  return (
    <div
      className={styles.app}
      data-chat-hidden={chatHidden || undefined}
      style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
    >
      <ChatPanel
        agent={state.agent}
        chat={state.chat}
        connected={state.connected}
        problems={problems}
        draft={draft}
        onDraft={setDraft}
        send={send}
        composerRef={composer}
        annotations={annotations}
        onRemoveAnnotation={(index) => frame.current?.removePick(index)}
        onClearAnnotations={() => frame.current?.clearPicks()}
        picking={picking}
        onTogglePick={() => (picking ? finishPicking() : setPicking(true))}
        reviewing={Boolean(review)}
      />
      {!chatHidden && <ChatResizer width={chatWidth} onResize={setChatWidth} />}
      <main className={styles.main}>
        <header className={styles.bar}>
          <button
            type="button"
            className={styles.chatToggle}
            aria-pressed={!chatHidden}
            aria-label={chatHidden ? "Show chat" : "Hide chat"}
            title={`${chatHidden ? "Show" : "Hide"} chat (Ctrl+B)`}
            onClick={() => setChatHidden((hidden) => !hidden)}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
              <path d="M6 3v10" />
              {chatHidden ? <path d="M9 6.5 10.5 8 9 9.5" /> : <path d="M10.5 6.5 9 8l1.5 1.5" />}
            </svg>
            {chatHidden && state.agent?.status === "busy" && (
              <span className={styles.chatToggleDot} aria-label="Agent is working" />
            )}
          </button>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden />
            Basis
          </span>
          <nav className={styles.pages} aria-label="Pages">
            {PAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => {
                  setPage(item.id);
                  if (review) setReviewHidden(true);
                  setActiveSection(undefined);
                  window.history.replaceState(null, "", " ");
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className={styles.actions}>
            <div className={styles.themeToggle} role="group" aria-label="Preview theme">
              {(["light", "dark"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
                  {value === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
            <HistoryMenu
              history={history}
              inspecting={inspectId}
              onInspect={setInspectId}
              send={send}
              locked={Boolean(review)}
            />
            <button type="button" className={styles.primaryButton} onClick={() => setExporting(true)} disabled={!live}>
              Export
            </button>
          </div>
        </header>
        {inspectEntry && live && (
          <InspectBanner
            entry={inspectEntry}
            snapshot={snapshot}
            current={live}
            hasOlder={inspectIndex > 0}
            hasNewer={inspectIndex < history.length - 2}
            onStep={step}
            onRestore={() => {
              send({ type: "revert", historyId: inspectEntry.id });
              setInspectId(null);
            }}
            onExit={() => setInspectId(null)}
          />
        )}
        {review && live && (
          <ReviewBar
            review={review}
            baselineDesign={baseline?.design}
            current={live}
            busy={state.agent?.status === "busy"}
            problems={problems.length}
            impact={impactSections}
            peeks={peeks}
            onTogglePeek={(id) => {
              setPeeks((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
              setReviewHidden(false);
            }}
            layout={reviewLayout}
            onLayout={setReviewLayout}
            showing={!reviewHidden}
            onShowing={(showing) => setReviewHidden(!showing)}
            onStep={(id) => send({ type: "review-step", id })}
            onApprove={() => send({ type: "review-approve" })}
            onDiscard={() => send({ type: "review-discard" })}
          />
        )}
        <div className={styles.stage}>
          <Sidebar
            active={activeSection}
            sections={sections}
            page={page}
            onNavigate={(id) => {
              window.history.replaceState(null, "", `#${id}`);
              if (!reviewView) return frame.current?.scrollTo(id);
              // The sidebar navigates the gallery: leave the review view, then scroll once the page is back.
              setReviewHidden(true);
              setTimeout(() => frame.current?.scrollTo(id), 120);
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onCreate={() => setCreating(true)}
          />
          {design && state.previewPort ? (
            <PreviewFrame
              ref={frame}
              port={state.previewPort}
              design={design}
              theme={theme}
              page={page}
              review={reviewView}
              picking={picking}
              inspecting={Boolean(inspectEntry)}
              onPicks={setAnnotations}
              onPickingEnd={finishPicking}
              onAsk={ask}
              onImpact={setImpact}
              onActiveSection={setActiveSection}
              onErrors={setPreviewErrors}
              onSections={setSections}
            />
          ) : (
            <p className={styles.loading}>Connecting to the Basis server…</p>
          )}
        </div>
      </main>
      {creating && (
        <CreateDialog
          page={page}
          agentReady={state.connected && state.agent?.status === "ready"}
          send={send}
          onCreated={() => setChatHidden(false)}
          onClose={() => setCreating(false)}
        />
      )}
      {exporting && live && state.design && (
        <ExportDialog
          design={live}
          workspace={state.design.workspace}
          problems={problems.length}
          manifest={state.exportManifest}
          result={state.exportResult}
          send={send}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}
