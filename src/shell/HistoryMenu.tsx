import { useEffect, useRef, useState } from "react";
import type { ClientMessage, HistoryEntry } from "../../shared/protocol.ts";
import { describeChanges, SOURCE_LABEL, undoStep, when } from "./history.ts";
import styles from "./Shell.module.css";

interface HistoryMenuProps {
  history: HistoryEntry[];
  inspecting: string | null;
  onInspect: (id: string | null) => void;
  send: (message: ClientMessage) => void;
  /** True while a review is open: history waits until it is approved or discarded. */
  locked?: boolean;
}

export function HistoryMenu({ history, inspecting, onInspect, send, locked = false }: HistoryMenuProps) {
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
  const undo = undoStep(history);

  return (
    <div ref={root} className={styles.menuRoot}>
      <button
        type="button"
        className={styles.chromeButton}
        onClick={() => undo && send({ type: "revert", historyId: undo.target.id })}
        disabled={!undo || locked}
        title={
          locked
            ? "Approve or discard the review first"
            : undo
              ? `Undo ${undo.undoes.label ? `“${undo.undoes.label}”` : SOURCE_LABEL[undo.undoes.source].toLowerCase()} (${describeChanges(undo.undoes).toLowerCase()})`
              : "Nothing to undo"
        }
      >
        Undo
      </button>
      <button
        type="button"
        className={styles.chromeButton}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={locked}
        title={locked ? "Approve or discard the review first" : undefined}
      >
        History · {history.length}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <p className={styles.menuHint}>Click a version to inspect it without changing anything.</p>
          {entries.map((entry, index) => {
            const isCurrent = index === 0;
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className={styles.menuItem}
                aria-current={entry.id === inspecting || (isCurrent && !inspecting) || undefined}
                onClick={() => {
                  onInspect(isCurrent ? null : entry.id);
                  setOpen(false);
                }}
              >
                <span className={styles.menuTitle}>
                  {SOURCE_LABEL[entry.source]}
                  {isCurrent && <span className={styles.current}>current</span>}
                </span>
                {entry.label && <span className={styles.menuLabel}>{entry.label}</span>}
                <span className={styles.muted}>
                  {when(entry.at)} · {describeChanges(entry)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
