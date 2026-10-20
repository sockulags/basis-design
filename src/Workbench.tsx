import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Annotation } from "../shared/annotations.ts";
import {
  isPageId,
  type FromPreview,
  type FullScreenView,
  type NavSection,
  type PageId,
  type PreviewView,
} from "../shared/frame.ts";
import type { ClientMessage, Tagged } from "../shared/protocol.ts";
import type { BridgeState } from "./bridge.ts";
import { ChatPanel, ChatRail } from "./chat/ChatPanel.tsx";
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
import { formatRoute, parseRoute } from "./shell/route.ts";
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
export function Workbench({
  state,
  send: sendProject,
}: {
  state: BridgeState;
  send: (message: Tagged<ClientMessage>) => void;
}) {
  // What the workbench sends names the thread it shows: a prompt goes there, whatever thread runs.
  const thread = state.thread ?? undefined;
  const send = useCallback((message: ClientMessage) => sendProject({ ...message, thread }), [sendProject, thread]);
  const [theme, setTheme] = useTheme();
  const [chatWidth, setChatWidth] = usePref("chat-width", asChatWidth);
  const [chatHidden, setChatHidden] = usePref("chat-hidden", asFlag);
  const [sidebarCollapsed, setSidebarCollapsed] = usePref("sidebar-collapsed", asFlag);
  const projectId = state.project?.id;
  // Where the address says to be, when it names this project; otherwise the page shown last, as cards.
  const [arrived] = useState(() => parseRoute(location.pathname, location.search));
  const here = Boolean(projectId) && arrived.project === projectId;
  const [page, setPage] = usePref("page", (stored) => (here && arrived.page ? arrived.page : asPage(stored)));
  /** The section shown alone, or null for the page. */
  const [focus, setFocus] = useState<string | null>(here ? arrived.focus : null);
  /** The whole page on one page instead of its cards. */
  const [all, setAll] = useState(here && arrived.all);
  // The unsent message survives a reload, one per thread of each project (the workbench is mounted once per project).
  const [draft, setDraft] = usePref(`draft:${state.project?.id ?? ""}:${thread ?? ""}`, (stored) => stored ?? "", {
    delay: 300,
  });
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [picking, setPicking] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>();
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewChecks, setPreviewChecks] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  /** The preview document's generation (see shared/hold.ts), so the fix loop can tell a report from after a reload. */
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const [sections, setSections] = useState<NavSection[]>([]);
  /** A view shown alone over everything, Basis' chrome included (see PreviewFrame and src/preview/FullScreen.tsx). */
  const [fullscreen, setFullscreen] = useState<FullScreenView | null>(null);
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

  // Ctrl/Cmd+J (or B) toggles the chat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && (key === "j" || key === "b")) {
        event.preventDefault();
        setChatHidden((hidden) => !hidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setChatHidden]);

  // The agent is blocked until a permission is answered, so bring the chat back for it (another thread's shows there).
  const pendingPermission =
    state.chat.some((item) => item.kind === "permission" && !item.resolved) ||
    state.threads.some((entry) => entry.status === "waiting");
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
        generation: previewGeneration,
      });
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [previewErrors, previewChecks, checking, previewGeneration, state.connected, send]);

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

  /** Shows a section alone (null: the page's cards), or the whole page; leaves a review the user had open. */
  const hideReview = reviewing.setHidden;
  const goTo = useCallback(
    (next: string | null, nextAll = false) => {
      setFocus(next);
      setAll(nextAll);
      setActiveSection(undefined);
      hideReview(true);
    },
    [hideReview],
  );

  const { setImpact } = reviewing;
  /** Everything the preview reports, already validated by the frame. */
  const onPreviewMessage = useCallback(
    (message: FromPreview) => {
      switch (message.type) {
        case "ready":
          // A fresh document (first load, or the reload after a turn) starts without picks, and without the errors
          // and findings of the one before; it reports its own next, and has not checked anything yet.
          setAnnotations([]);
          setPreviewErrors([]);
          setPreviewChecks([]);
          setChecking(true);
          return setPreviewGeneration(message.generation);
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
        case "fullscreen-open":
          // Only right after a click in the gallery (the browser passes it up from the frame), so the preview cannot
          // cover the window on its own; the browser's own full screen asks the same.
          if (navigator.userActivation && !navigator.userActivation.isActive) return;
          setPicking(false);
          return setFullscreen({ view: message.view, screen: message.screen, theme: message.theme });
        case "fullscreen-exit":
          return setFullscreen(null);
        case "navigate":
          // Only right after a click in the gallery, so the preview's code cannot move the chrome on its own.
          if (navigator.userActivation && !navigator.userActivation.isActive) return;
          return goTo(message.focus, message.all === true);
        case "widths-set":
          // Only right after the user acted in the gallery, so the preview's code cannot change them on its own.
          if (navigator.userActivation && !navigator.userActivation.isActive) return;
          return send({ type: "widths-set", widths: message.widths });
      }
    },
    [ask, finishPicking, setImpact, send, goTo],
  );

  const view = useMemo<PreviewView | null>(
    () =>
      design ? { design, theme, page, review: reviewing.view, fullscreen, widths: state.widths, focus, all } : null,
    [design, theme, page, reviewing.view, fullscreen, state.widths, focus, all],
  );

  // The address follows where the chrome is, one history entry per move, so back and forward retrace them. The
  // first only corrects the address the tab opened at.
  const addressed = useRef(false);
  useEffect(() => {
    if (!projectId) return;
    const url = formatRoute({ project: projectId, page, focus, all });
    if (url !== location.pathname + location.search)
      window.history[addressed.current ? "pushState" : "replaceState"](null, "", url);
    addressed.current = true;
  }, [projectId, page, focus, all]);
  useEffect(() => {
    const onPop = () => {
      const route = parseRoute(location.pathname, location.search);
      // Another project's address: the server shows that project in this tab, and its workbench takes over.
      if (route.project && route.project !== projectId)
        return sendProject({ type: "project-switch", id: route.project });
      if (route.page) setPage(route.page);
      setFocus(route.focus);
      setAll(route.all);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projectId, sendProject, setPage]);

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
      <main className={styles.main}>
        <h1 className="visually-hidden">Basis</h1>
        <TopBar
          page={page}
          onPage={(next) => {
            setPage(next);
            if (review) reviewing.setHidden(true);
            setActiveSection(undefined);
            setFocus(null);
            setAll(false);
          }}
          theme={theme}
          onTheme={setTheme}
          project={
            <ProjectMenu
              project={state.project}
              projects={state.projects}
              status={state.status}
              agentBusy={state.agent?.status === "busy"}
              error={state.projectError}
              templateUpdate={state.design?.templateUpdate ?? null}
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
              showThreads={state.threads.length > 1}
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
            active={all ? activeSection : (focus ?? undefined)}
            sections={sections}
            page={page}
            overview={!focus && !all && !reviewing.view}
            all={all}
            hrefFor={(id, wholePage) =>
              projectId ? formatRoute({ project: projectId, page, focus: id, all: wholePage ?? false }) : "#"
            }
            onOverview={() => goTo(null)}
            onAll={() => goTo(null, true)}
            onNavigate={(id) => {
              // With everything on one page, the sidebar scrolls to the section; otherwise it shows it alone.
              if (!all) return goTo(id);
              if (!reviewing.view) return frame.current?.scrollTo(id);
              // Leave the review view, then scroll once the page is back.
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
              waiting={state.previewWaiting}
              onMessage={onPreviewMessage}
              onFullScreenEnd={() => setFullscreen(null)}
            />
          ) : (
            <p className={styles.loading}>Connecting to the Basis server…</p>
          )}
        </div>
      </main>
      <ChatPanel
        agent={state.agent}
        threads={state.threads}
        thread={state.thread}
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
        onHide={() => setChatHidden(true)}
      />
      {chatHidden && (
        <ChatRail
          busy={state.agent?.status === "busy"}
          attention={pendingPermission}
          onShow={() => setChatHidden(false)}
        />
      )}
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
          projectId={state.project?.id}
          workspace={state.design.workspace}
          problems={problems.length}
          manifest={state.exportManifest}
          result={state.exportResult}
          send={send}
          onClose={() => setExporting(false)}
          verify={{
            repo: state.project?.repo,
            views: sections.filter((section) => section.page === "views").map(({ id, title }) => ({ id, title })),
            progress: state.verifyProgress,
            result: state.verifyResult,
          }}
        />
      )}
    </div>
  );
}
