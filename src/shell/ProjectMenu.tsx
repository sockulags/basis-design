import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ProjectEntry } from "../../shared/protocol.ts";
import styles from "./Shell.module.css";

interface ProjectMenuProps {
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  /** Switching, creating and opening wait while the agent works. */
  agentBusy: boolean;
  /** The server's answer to the last failed project request. */
  error: { message: string } | null;
  send: (message: ClientMessage) => void;
}

type Dialog = "create" | "open" | "repo" | null;

/**
 * The open project, where the brand used to be, with the list of projects:
 * switch to one, start a new one, or open a workspace folder from elsewhere.
 */
export function ProjectMenu({ project, projects, agentBusy, error, send }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** The error when the last request went out; a different one (even with the same text) is the answer to it. */
  const [errorBefore, setErrorBefore] = useState<{ message: string } | null | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const answer = errorBefore !== undefined && error !== errorBefore ? (error?.message ?? null) : null;

  // Linking happens in place (no project switch), so the dialog closes once the entry shows the change.
  const repo = project?.repo;
  const repoBefore = useRef(repo);
  useEffect(() => {
    if (repo !== repoBefore.current && dialog === "repo") setDialog(null);
    repoBefore.current = repo;
  }, [repo, dialog]);

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
                  {entry.repo && <span className={styles.projectDir}>Product repo: {entry.repo}</span>}
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
          {project && (
            <div className={styles.projectRepo}>
              <span className={styles.projectRepoHint}>
                {project.repo
                  ? "The agent reads the linked product repo to match your product; it never writes there."
                  : "Link the product repo this design system is for, so the agent can match it."}
              </span>
              <div className={styles.projectRepoActions}>
                <button
                  type="button"
                  className={styles.chromeButton}
                  onClick={() => {
                    setOpen(false);
                    setDialog("repo");
                  }}
                >
                  {project.repo ? "Change repo…" : "Link product repo…"}
                </button>
                {project.repo && (
                  <button
                    type="button"
                    className={styles.chromeButton}
                    onClick={() => {
                      setOpen(false);
                      send({ type: "import-design" });
                    }}
                    title="The agent reads the repo and restyles this design system to match it, in a review"
                  >
                    Bring in its design
                  </button>
                )}
                {project.repo && (
                  <button
                    type="button"
                    className={styles.chromeButton}
                    onClick={() => request({ type: "project-repo", id: project.id, repo: null })}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </div>
          )}
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
  mode: "create" | "open" | "repo";
  current: ProjectEntry | null;
  error: string | null;
  onSubmit: (message: ClientMessage) => void;
  onClose: () => void;
}

function ProjectDialog({ mode, current, error, onSubmit, onClose }: ProjectDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [copyCurrent, setCopyCurrent] = useState(false);
  /** A new project can start from a product repo instead (linked, with its design system brought in). */
  const [fromRepo, setFromRepo] = useState(false);
  /** Linking can start bringing in the repo's design system right away; changing a linked repo does not by default. */
  const [bringIn, setBringIn] = useState(!current?.repo);
  const [dir, setDir] = useState(mode === "repo" ? (current?.repo ?? "") : "");
  const [pending, setPending] = useState(false);
  const valid = mode === "create" ? (fromRepo ? dir.trim().length > 0 : name.trim().length > 0) : dir.trim().length > 0;

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
        ? fromRepo
          ? { type: "project-create", name: name.trim(), copyCurrent: false, repo: dir.trim() }
          : { type: "project-create", name: name.trim(), copyCurrent }
        : mode === "repo"
          ? { type: "project-repo", id: current?.id ?? "", repo: dir.trim(), bringIn }
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
            <h2>{mode === "create" ? "New project" : mode === "repo" ? "Link a product repo" : "Open a folder"}</h2>
            <p>
              {mode === "create"
                ? "A design system of its own, with its own history and chat. It lives in Basis' workspaces folder."
                : mode === "repo"
                  ? `The repo ${current?.name ?? "this project"} designs for. The agent reads it to match the product's look, components and terms; it never writes there.`
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
                placeholder={fromRepo ? "The repo folder's name" : "Acme dashboard"}
                autoComplete="off"
                autoFocus
              />
              <fieldset className={styles.projectStart}>
                <legend>Start from</legend>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={!copyCurrent && !fromRepo}
                    onChange={() => {
                      setCopyCurrent(false);
                      setFromRepo(false);
                    }}
                  />
                  Basis' defaults
                </label>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={copyCurrent && !fromRepo}
                    onChange={() => {
                      setCopyCurrent(true);
                      setFromRepo(false);
                    }}
                  />
                  A copy of {current?.name ?? "the open project"} (tokens and components, not its history)
                </label>
                <label>
                  <input type="radio" name="start" checked={fromRepo} onChange={() => setFromRepo(true)} />A product
                  repo: linked, and the agent brings in its design system
                </label>
              </fieldset>
              {fromRepo && (
                <>
                  <label htmlFor="project-repo">Repo folder</label>
                  <input
                    id="project-repo"
                    value={dir}
                    onChange={(event) => setDir(event.target.value)}
                    placeholder="C:\\Code\\my-app"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </>
              )}
            </>
          ) : (
            <>
              <label htmlFor="project-dir">{mode === "repo" ? "Repo folder" : "Folder"}</label>
              <input
                id="project-dir"
                value={dir}
                onChange={(event) => setDir(event.target.value)}
                placeholder={mode === "repo" ? "C:\\Code\\my-app" : "C:\\Code\\my-app\\design-system"}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <p className={styles.muted}>Use the full path.</p>
              {mode === "repo" && (
                <label className={styles.projectCheck}>
                  <input type="checkbox" checked={bringIn} onChange={(event) => setBringIn(event.target.checked)} />
                  Bring in its design system now: the agent restyles this project to match, in a review
                </label>
              )}
            </>
          )}
          {error && <p className={styles.kitError}>{error}</p>}
        </div>
        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.chromeButton} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={!valid || pending}>
            {pending
              ? mode === "repo"
                ? "Linking…"
                : "Opening…"
              : mode === "create"
                ? "Create project"
                : mode === "repo"
                  ? "Link repo"
                  : "Open folder"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
