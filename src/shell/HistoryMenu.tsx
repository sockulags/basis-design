import { useEffect, useRef, useState } from "react";
import type { ClientMessage, HistoryEntry } from "../../shared/protocol.ts";
import styles from "./Shell.module.css";

const SOURCE_LABEL: Record<HistoryEntry["source"], string> = {
  init: "Starting point",
  agent: "Agent change",
  revert: "Restored",
  external: "Edited on disk",
};

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function when(at: number): string {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString() ? time.format(date) : `${day.format(date)} ${time.format(date)}`;
}

export function HistoryMenu({ history, send }: { history: HistoryEntry[]; send: (message: ClientMessage) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const entries = history.slice().reverse();
  const undo = entries[1];

  return (
    <div ref={root} className={styles.menuRoot}>
      <button
        type="button"
        className={styles.chromeButton}
        onClick={() => undo && send({ type: "revert", historyId: undo.id })}
        disabled={!undo}
        title={undo ? `Restore the version from ${when(undo.at)}` : "Nothing to undo"}
      >
        Undo
      </button>
      <button type="button" className={styles.chromeButton} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        History · {history.length}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {entries.map((entry, index) => (
            <div key={entry.id} className={styles.menuItem}>
              <div>
                <span className={styles.menuTitle}>
                  {SOURCE_LABEL[entry.source]}
                  {index === 0 && <span className={styles.current}>current</span>}
                </span>
                <span className={styles.muted}>
                  {when(entry.at)} · {entry.name}
                </span>
              </div>
              {index > 0 && (
                <button
                  type="button"
                  className={styles.chromeButton}
                  onClick={() => {
                    send({ type: "revert", historyId: entry.id });
                    setOpen(false);
                  }}
                >
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
