import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ProjectEntry } from "../../shared/protocol.ts";
import styles from "./Shell.module.css";

interface ProjectMenuProps {
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  /** Switching, creating and opening wait while the agent works. */
  agentBusy: boolean;
  /** The server's answer to the last failed project request. */
  error: string | null;
  send: (message: ClientMessage) => void;
}

type Dialog = "create" | "open" | null;

/**
 * The open project, where the brand used to be, with the list of projects:
 * switch to one, start a new one, or open a workspace folder from elsewhere.
 */
export function ProjectMenu({ project, projects, agentBusy, error, send }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** The error value when the last request went out; a different one is the answer to it. */
  const [errorBefore, setErrorBefore] = useState<string | null | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const answer = errorBefore !== undefined && error !== errorBefore ? error : null;

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

  const request = (message: ClientMessage) => {
    setErrorBefore(error);
    send(message);
  };

  return (
    <div ref={root} className={styles.projectRoot}>
      <button
        type="button"
        className={styles.projectButton}
        aria-expanded={open}
        aria-haspopup="menu"
        title={project?.dir}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.brandMark} aria-hidden />
        <span className={styles.projectName}>{project?.name ?? "Basis"}</span>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.projectMenu}`} role="menu">
          <p className={styles.menuHint}>
            {agentBusy
              ? "The agent is working; switch projects when it is done."
              : "Each project has its own design system, history and chat."}
          </p>
          {answer && !dialog && <p className={styles.projectError}>{answer}</p>}
          {projects.map((entry) => {
            const isOpen = entry.id === project?.id;
            return (
              <div key={entry.id} className={styles.projectRow}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  aria-current={isOpen || undefined}
                  disabled={agentBusy && !isOpen}
                  onClick={() => (isOpen ? setOpen(false) : request({ type: "project-switch", id: entry.id }))}
                >
                  <span className={styles.menuTitle}>
                    {entry.name}
                    {isOpen && <span className={styles.current}>open</span>}
                  </span>
                  <span className={styles.projectDir}>{entry.dir}</span>
                </button>
                {!isOpen && (
                  <button
                    type="button"
                    className={styles.projectRemove}
                    aria-label={`Remove ${entry.name} from the list`}
                    title="Remove from the list (the folder stays)"
                    onClick={() => send({ type: "project-remove", id: entry.id })}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          <div className={styles.projectActions}>
            <button
              type="button"
              className={styles.chromeButton}
              disabled={agentBusy}
              onClick={() => {
                setOpen(false);
                setDialog("create");
              }}
            >
              New project…
            </button>
            <button
              type="button"
              className={styles.chromeButton}
              disabled={agentBusy}
              onClick={() => {
                setOpen(false);
                setDialog("open");
              }}
            >
              Open folder…
            </button>
          </div>
        </div>
      )}
      {dialog && (
        <ProjectDialog
          mode={dialog}
          current={project}
          error={answer}
          onSubmit={(message) => request(message)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

interface ProjectDialogProps {
  mode: "create" | "open";
  current: ProjectEntry | null;
  error: string | null;
  onSubmit: (message: ClientMessage) => void;
  onClose: () => void;
}

function ProjectDialog({ mode, current, error, onSubmit, onClose }: ProjectDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const [dir, setDir] = useState("");
  const [pending, setPending] = useState(false);
  const valid = mode === "create" ? name.trim().length > 0 : dir.trim().length > 0;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // An answer means the request failed; the dialog stays for another try. Success replaces the whole workbench.
  useEffect(() => {
    if (error) setPending(false);
  }, [error]);

  const submit = () => {
    if (!valid || pending) return;
    setPending(true);
    onSubmit(
      mode === "create"
        ? { type: "project-create", name: name.trim(), copyCurrent }
        : { type: "project-open", dir: dir.trim() },
    );
  };

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.createDialog}`}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
    >
      <form
        className={styles.dialogInner}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className={styles.dialogHeader}>
          <div>
            <h2>{mode === "create" ? "New project" : "Open a folder"}</h2>
            <p>
              {mode === "create"
                ? "A design system of its own, with its own history and chat. It lives in Basis' workspaces folder."
                : "A Basis workspace anywhere on this computer, or an empty or new folder (inside a product repo, say) for Basis to set up."}
            </p>
          </div>
        </header>
        <div className={styles.createFields}>
          {mode === "create" ? (
            <>
              <label htmlFor="project-name">Name</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme dashboard"
                autoComplete="off"
                autoFocus
              />
              <fieldset className={styles.projectStart}>
                <legend>Start from</legend>
                <label>
                  <input type="radio" name="start" checked={!copyCurrent} onChange={() => setCopyCurrent(false)} />
                  Basis' defaults
                </label>
                <label>
                  <input type="radio" name="start" checked={copyCurrent} onChange={() => setCopyCurrent(true)} />A copy
                  of {current?.name ?? "the open project"} (tokens and components, not its history)
                </label>
              </fieldset>
            </>
          ) : (
            <>
              <label htmlFor="project-dir">Folder</label>
              <input
                id="project-dir"
                value={dir}
                onChange={(event) => setDir(event.target.value)}
                placeholder="C:\Code\my-app\design-system"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <p className={styles.muted}>Use the full path.</p>
            </>
          )}
          {error && <p className={styles.kitError}>{error}</p>}
        </div>
        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.chromeButton} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={!valid || pending}>
            {pending ? "Opening…" : mode === "create" ? "Create project" : "Open folder"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
