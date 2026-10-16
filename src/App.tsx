import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Annotation } from "../shared/annotations.ts";
import { useBridge } from "./bridge.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { PickLayer, PickMarkers, type Pick } from "./picker/PickLayer.tsx";
import { Preview, SECTIONS } from "./preview/Preview.tsx";
import { CHAT_DEFAULT_WIDTH, ChatResizer, clampChatWidth } from "./shell/ChatResizer.tsx";
import { ExportDialog } from "./shell/ExportDialog.tsx";
import { HistoryMenu } from "./shell/HistoryMenu.tsx";
import { InspectBanner } from "./shell/InspectBanner.tsx";
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
  const [draft, setDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [picking, setPicking] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const live = state.design?.design;

  const history = state.history;
  const inspectIndex = inspectId ? history.findIndex((entry) => entry.id === inspectId) : -1;
  const inspectEntry = inspectIndex >= 0 ? history[inspectIndex] : undefined;
  const snapshot = inspectId ? state.snapshots[inspectId] : undefined;
  const design = inspectEntry ? (snapshot ?? live) : live;

  useEffect(() => writePref("theme", theme), [theme]);
  useEffect(() => writePref("chat-width", String(chatWidth)), [chatWidth]);
  useEffect(() => writePref("chat-hidden", String(chatHidden)), [chatHidden]);

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

  const togglePick = useCallback((annotation: Annotation, element: HTMLElement) => {
    setPicks((current) =>
      current.some((pick) => pick.element === element)
        ? current.filter((pick) => pick.element !== element)
        : [...current, { annotation, element }],
    );
  }, []);

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
        designErrors={state.design?.errors ?? null}
        draft={draft}
        onDraft={setDraft}
        send={send}
        composerRef={composer}
        annotations={picks.map((pick) => pick.annotation)}
        onRemoveAnnotation={(index) => setPicks((current) => current.filter((_, i) => i !== index))}
        onClearAnnotations={() => setPicks([])}
        picking={picking}
        onTogglePick={() => (picking ? finishPicking() : setPicking(true))}
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
            {chatHidden && state.agent?.status === "busy" && <span className={styles.chatToggleDot} aria-label="Agent is working" />}
          </button>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden />
            Basis
          </span>
          <nav className={styles.sections} aria-label="Sections">
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
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
            <HistoryMenu history={history} inspecting={inspectId} onInspect={setInspectId} send={send} />
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
        <div ref={canvas} className={styles.canvas} data-inspecting={inspectEntry ? true : undefined}>
          {design ? (
            <Preview design={design} theme={theme} onAsk={ask} />
          ) : (
            <p className={styles.loading}>Connecting to the Basis server…</p>
          )}
        </div>
        {picks.length > 0 && <PickMarkers container={canvas} picks={picks} />}
        {picking && design && (
          <PickLayer container={canvas} design={design} picks={picks} onToggle={togglePick} onDone={finishPicking} />
        )}
      </main>
      {exporting && live && state.design && (
        <ExportDialog design={live} workspace={state.design.workspace} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}
