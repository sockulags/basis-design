import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Annotation } from "../shared/annotations.ts";
import { isPageId, type FromPreview, type NavSection, type PageId, type PreviewView } from "../shared/frame.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import type { BridgeState } from "./bridge.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { CHAT_DEFAULT_WIDTH, ChatResizer, clampChatWidth } from "./shell/ChatResizer.tsx";
import { CreateDialog } from "./shell/CreateDialog.tsx";
import { ExportDialog } from "./shell/ExportDialog.tsx";
import { HistoryMenu } from "./shell/HistoryMenu.tsx";
import { InspectBanner } from "./shell/InspectBanner.tsx";
import { usePref, useTheme } from "./shell/prefs.ts";
import { PreviewFrame, type PreviewFrameHandle } from "./shell/PreviewFrame.tsx";
import { ProjectMenu } from "./shell/ProjectMenu.tsx";
import { ReviewBar } from "./shell/ReviewBar.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import styles from "./shell/Shell.module.css";
import { TopBar } from "./shell/TopBar.tsx";
import { useReview } from "./shell/useReview.ts";

const asFlag = (stored: string | null) => stored === "true";
const asPage = (stored: string | null): PageId => (isPageId(stored) ? stored : "system");
const asChatWidth = (stored: string | null) => {
  const width = Number(stored);
  return clampChatWidth(Number.isFinite(width) && width > 0 ? width : CHAT_DEFAULT_WIDTH);
};

/**
 * Everything for the open project: chat, preview, history, review and dialogs.
 * App mounts it once per project, so switching projects starts it fresh.
 */
export function Workbench({ state, send }: { state: BridgeState; send: (message: ClientMessage) => void }) {
  const [theme, setTheme] = useTheme();
  const [chatWidth, setChatWidth] = usePref("chat-width", asChatWidth);
  const [chatHidden, setChatHidden] = usePref("chat-hidden", asFlag);
  const [sidebarCollapsed, setSidebarCollapsed] = usePref("sidebar-collapsed", asFlag);
  const [page, setPage] = usePref("page", asPage);
  // The unsent message survives a reload.
  const [draft, setDraft] = usePref("draft", (stored) => stored ?? "", { delay: 300 });
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [picking, setPicking] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>();
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewChecks, setPreviewChecks] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [sections, setSections] = useState<NavSection[]>([]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<PreviewFrameHandle>(null);
  const live = state.design?.design;
  const reviewing = useReview(state, send, sections, () => setInspectId(null));
  const { review } = reviewing;

  const history = state.history;
  const inspectIndex = inspectId ? history.findIndex((entry) => entry.id === inspectId) : -1;
  const inspectEntry = inspectIndex >= 0 ? history[inspectIndex] : undefined;
  const snapshot = inspectId ? state.snapshots[inspectId] : undefined;
  const design = inspectEntry ? (snapshot?.design ?? live) : live;

  // Keep the stored width valid when the window shrinks.
  useEffect(() => {
    const onResize = () => setChatWidth((width) => clampChatWidth(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setChatWidth]);

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
  }, [setChatHidden]);

  // The agent is blocked until a permission is answered, so bring the chat back for it.
  const pendingPermission = state.chat.some((item) => item.kind === "permission" && !item.resolved);
  useEffect(() => {
    if (pendingPermission) setChatHidden(false);
  }, [pendingPermission, setChatHidden]);

  useEffect(() => {
    if (inspectId && !state.snapshots[inspectId]) send({ type: "snapshot-get", id: inspectId });
  }, [inspectId, state.snapshots, send]);

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
  }, [setChatHidden]);

  const ask = useCallback(
    (prefix: string) => {
      setDraft((current) => (current.trim() ? `${current.trimEnd()}\n${prefix}` : prefix));
      focusComposer();
    },
    [focusComposer, setDraft],
  );

  // The server folds what the preview fails to render into the agent's fix loop. It also needs to know whether
  // this tab is visible, so a stale or second tab does not speak for the one the user looks at.
  useEffect(() => {
    if (!state.connected) return;
    const report = () =>
      send({
        type: "preview-errors",
        errors: previewErrors,
        checks: previewChecks,
        checking,
        visible: !document.hidden,
      });
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [previewErrors, previewChecks, checking, state.connected, send]);

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

  // The preview's checks, and the colours in the source that ignore the theme (the server finds those).
  const checks = [...previewChecks, ...(state.design?.colorFindings ?? []).map((finding) => `Themes: ${finding}`)];

  const finishPicking = useCallback(() => {
    setPicking(false);
    focusComposer();
  }, [focusComposer]);

  const { setImpact } = reviewing;
  /** Everything the preview reports, already validated by the frame. */
  const onPreviewMessage = useCallback(
    (message: FromPreview) => {
      switch (message.type) {
        case "ready":
          // A fresh document (first load or a full reload after an edit) starts without picks.
          return setAnnotations([]);
        case "active-section":
          return setActiveSection(message.id);
        case "ask":
          return ask(message.prefix);
        case "picks":
          return setAnnotations(message.annotations);
        case "picking":
          if (!message.on) finishPicking();
          return;
        case "errors":
          return setPreviewErrors(message.errors);
        case "checks":
          setChecking(message.running);
          return setPreviewChecks(message.checks);
        case "sections":
          return setSections(message.sections);
        case "impact":
          return setImpact(message.ids);
      }
    },
    [ask, finishPicking, setImpact],
  );

  const view = useMemo<PreviewView | null>(
    () => (design ? { design, theme, page, review: reviewing.view } : null),
    [design, theme, page, reviewing.view],
  );

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
        checks={checks}
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
        resizer={!chatHidden && <ChatResizer width={chatWidth} onResize={setChatWidth} />}
      />
      <main className={styles.main}>
        <h1 className="visually-hidden">Basis</h1>
        <TopBar
          chatHidden={chatHidden}
          onToggleChat={() => setChatHidden((hidden) => !hidden)}
          agentBusy={state.agent?.status === "busy"}
          page={page}
          onPage={(next) => {
            setPage(next);
            if (review) reviewing.setHidden(true);
            setActiveSection(undefined);
            window.history.replaceState(null, "", " ");
          }}
          theme={theme}
          onTheme={setTheme}
          project={
            <ProjectMenu
              project={state.project}
              projects={state.projects}
              agentBusy={state.agent?.status === "busy"}
              error={state.projectError}
              send={send}
            />
          }
          history={
            <HistoryMenu
              history={history}
              inspecting={inspectId}
              onInspect={setInspectId}
              send={send}
              locked={Boolean(review)}
            />
          }
          onExport={() => setExporting(true)}
          canExport={Boolean(live)}
        />
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
            baselineDesign={reviewing.baseline?.design}
            current={live}
            busy={state.agent?.status === "busy"}
            problems={problems.length}
            impact={reviewing.impactSections}
            peeks={reviewing.peeks}
            onTogglePeek={reviewing.togglePeek}
            layout={reviewing.layout}
            onLayout={reviewing.setLayout}
            showing={!reviewing.hidden}
            onShowing={(showing) => reviewing.setHidden(!showing)}
            onStep={(id) => send({ type: "review-step", id })}
            onChoose={(label) => send({ type: "review-choose", label })}
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
              if (!reviewing.view) return frame.current?.scrollTo(id);
              // The sidebar navigates the gallery: leave the review view, then scroll once the page is back.
              reviewing.setHidden(true);
              setTimeout(() => frame.current?.scrollTo(id), 120);
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onCreate={() => setCreating(true)}
          />
          {view && state.previewPort ? (
            <PreviewFrame
              ref={frame}
              port={state.previewPort}
              view={view}
              picking={picking}
              inspecting={Boolean(inspectEntry)}
              onMessage={onPreviewMessage}
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
