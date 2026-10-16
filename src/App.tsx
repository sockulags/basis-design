import { useCallback, useEffect, useRef, useState } from "react";
import { useBridge } from "./bridge.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { Preview, SECTIONS } from "./preview/Preview.tsx";
import { ExportDialog } from "./shell/ExportDialog.tsx";
import { HistoryMenu } from "./shell/HistoryMenu.tsx";
import styles from "./shell/Shell.module.css";

type Theme = "light" | "dark";

function storedTheme(): Theme {
  try {
    return localStorage.getItem("basis:theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function App() {
  const { state, send } = useBridge();
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [draft, setDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const design = state.design?.design;

  useEffect(() => {
    try {
      localStorage.setItem("basis:theme", theme);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit.
    }
  }, [theme]);

  const ask = useCallback((prefix: string) => {
    setDraft((current) => (current.trim() ? `${current.trimEnd()}\n${prefix}` : prefix));
    requestAnimationFrame(() => {
      const el = composer.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  return (
    <div className={styles.app}>
      <ChatPanel
        agent={state.agent}
        chat={state.chat}
        connected={state.connected}
        designErrors={state.design?.errors ?? null}
        draft={draft}
        onDraft={setDraft}
        send={send}
        composerRef={composer}
      />
      <main className={styles.main}>
        <header className={styles.bar}>
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
            <HistoryMenu history={state.history} send={send} />
            <button type="button" className={styles.primaryButton} onClick={() => setExporting(true)} disabled={!design}>
              Export
            </button>
          </div>
        </header>
        <div className={styles.canvas}>
          {design ? (
            <Preview design={design} theme={theme} onAsk={ask} />
          ) : (
            <p className={styles.loading}>Connecting to the Basis server…</p>
          )}
        </div>
      </main>
      {exporting && design && state.design && (
        <ExportDialog design={design} workspace={state.design.workspace} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}
