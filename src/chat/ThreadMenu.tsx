import { useEffect, useId, useRef, useState } from "react";
import type { ClientMessage, ThreadStatus, ThreadSummary } from "../../shared/protocol.ts";
import { when } from "../shell/history.ts";
import shell from "../shell/Shell.module.css";
import styles from "./ChatPanel.module.css";

interface ThreadMenuProps {
  threads: ThreadSummary[];
  /** The thread this tab shows. */
  thread: string | null;
  /** Nothing was asked in the thread shown yet, so it is a new chat already. */
  empty: boolean;
  connected: boolean;
  send: (message: ClientMessage) => void;
}

/** How a row names what its thread is up to. */
const STATUS_LABELS: Record<ThreadStatus, string> = {
  working: "working",
  waiting: "waiting for approval",
  queued: "queued",
};

/**
 * The thread shown, above its chat, with the project's other threads: switch to one, start a new one, or remove
 * one that is idle. Each thread is its own conversation with the agent about the same workspace, and turns take
 * turns across threads; the rows say which works, waits for an approval or is queued, and the button shows a dot
 * when another thread works or waits, so it is not missed with the list shut.
 */
export function ThreadMenu({ threads, thread, empty, connected, send }: ThreadMenuProps) {
  const [open, setOpen] = useState(false);
  /** The thread whose remove button was pressed once; a second press removes it. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const current = threads.find((entry) => entry.id === thread);

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

  useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  const others = threads.filter((entry) => entry.id !== thread);
  const waiting = others.filter((entry) => entry.status === "waiting");
  const working = others.find((entry) => entry.status === "working");
  const attention = waiting.length
    ? `${waiting.map((entry) => `“${entry.title}”`).join(", ")} ${waiting.length === 1 ? "is" : "are"} waiting for approval`
    : working
      ? `“${working.title}” is working`
      : "";

  return (
    <div ref={root} className={styles.threadBar}>
      <button
        type="button"
        className={styles.threadButton}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={attention ? `${current?.title ?? ""}\n${attention}` : current?.title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="visually-hidden">Chat: </span>
        <span className={styles.threadTitle}>{current?.title ?? "Chat"}</span>
        {threads.length > 1 && (
          <span className={styles.threadCount}>
            {threads.length}
            <span className="visually-hidden"> chats</span>
          </span>
        )}
        {attention && (
          <span className={shell.attentionDot} data-status={waiting.length ? "waiting" : "working"}>
            <span className="visually-hidden">, {attention}</span>
          </span>
        )}
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={() => {
          setOpen(false);
          send({ type: "thread-new" });
        }}
        disabled={!connected || empty}
        title="Start another conversation with the agent (the design stays, and this chat stays in the list)"
      >
        New chat
      </button>
      {open && (
        // A panel the button discloses, as the project menu is: rows with buttons of their own.
        <div id={panelId} className={`${shell.menu} ${styles.threadMenu}`}>
          <p className={shell.menuHint}>
            Each chat is its own conversation with the agent about this design system. One turn runs at a time: a
            message sent while another chat&apos;s turn runs waits in the queue.
          </p>
          {threads.map((entry) => {
            const shown = entry.id === thread;
            return (
              <div key={entry.id} className={shell.projectRow}>
                <button
                  type="button"
                  className={shell.menuItem}
                  aria-current={shown || undefined}
                  onClick={() => {
                    setOpen(false);
                    if (!shown) send({ type: "thread-open", id: entry.id });
                  }}
                >
                  <span className={shell.menuTitle}>
                    {entry.title}
                    {shown && <span className={shell.current}>open</span>}
                    {entry.status && (
                      <span className={shell.projectStatus} data-status={entry.status}>
                        {STATUS_LABELS[entry.status]}
                      </span>
                    )}
                  </span>
                  <span className={shell.muted}>{when(entry.at)}</span>
                </button>
                {!shown && !entry.status && (
                  <button
                    type="button"
                    className={shell.projectRemove}
                    data-confirming={confirming === entry.id || undefined}
                    aria-label={confirming === entry.id ? `Remove ${entry.title} for good` : `Remove ${entry.title}`}
                    title={confirming === entry.id ? "Click again to remove this chat" : "Remove this chat"}
                    onClick={() => {
                      if (confirming !== entry.id) return setConfirming(entry.id);
                      setConfirming(null);
                      send({ type: "thread-remove", id: entry.id });
                    }}
                  >
                    {confirming === entry.id ? "Remove?" : "×"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
