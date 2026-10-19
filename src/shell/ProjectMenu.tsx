import { useEffect, useId, useRef, useState } from "react";
import type { ClientMessage, ProjectEntry, ProjectStatus, TemplateUpdate } from "../../shared/protocol.ts";
import { FolderField } from "./FolderField.tsx";
import styles from "./Shell.module.css";

interface ProjectMenuProps {
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  /** What the projects are up to, by id; the others go on in the background while this one is shown. */
  status: Record<string, ProjectStatus>;
  /** The open project's agent works: its template update waits. */
  agentBusy: boolean;
  /** The server's answer to the last failed project request. */
  error: { message: string } | null;
  /** A newer starter template the open project can bring in. */
  templateUpdate: TemplateUpdate | null;
  send: (message: ClientMessage) => void;
}

type Dialog = "create" | "open" | "repo" | null;

/** How a row names what its project is up to. */
const STATUS_LABELS: Record<ProjectStatus, string> = {
  working: "working",
  waiting: "waiting for approval",
  done: "done",
};

/**
 * The open project, where the brand used to be, with the list of projects:
 * switch to one, start a new one, or open a workspace folder from elsewhere.
 * Projects keep running when another is shown; the rows say which are
 * working, waiting for an approval or done, and the button shows a dot when
 * another project waits or finished, so it is not missed with the menu shut.
 */
export function ProjectMenu({ project, projects, status, agentBusy, error, templateUpdate, send }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** The error when the last request went out; a different one (even with the same text) is the answer to it. */
  const [errorBefore, setErrorBefore] = useState<{ message: string } | null | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
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

  const others = projects.filter((entry) => entry.id !== project?.id);
  const waiting = others.filter((entry) => status[entry.id] === "waiting");
  const done = others.filter((entry) => status[entry.id] === "done");
  const attention = waiting.length
    ? `${waiting.map((entry) => entry.name).join(", ")} ${waiting.length === 1 ? "is" : "are"} waiting for approval`
    : done.length
      ? `${done.map((entry) => entry.name).join(", ")} finished in the background`
      : "";

  return (
    <div ref={root} className={styles.projectRoot}>
      <button
        type="button"
        className={styles.projectButton}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={attention ? `${project?.dir ?? ""}\n${attention}` : project?.dir}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.brandMark} aria-hidden />
        <span className={styles.projectName}>{project?.name ?? "Basis"}</span>
        {attention && (
          <span className={styles.attentionDot} data-status={waiting.length ? "waiting" : "done"}>
            <span className="visually-hidden">, {attention}</span>
          </span>
        )}
        {templateUpdate && (
          <span className={styles.updateDot}>
            <span className="visually-hidden">, starter template update available</span>
          </span>
        )}
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>
      {open && (
        // A panel the button discloses, not a menu: it holds hints, rows with their own buttons and actions.
        <div id={panelId} className={`${styles.menu} ${styles.projectMenu}`}>
          <p className={styles.menuHint}>
            Each project has its own design system, history and chat, and its agent keeps working while you look at
            another.
          </p>
          {answer && !dialog && <p className={styles.projectError}>{answer}</p>}
          {projects.map((entry) => {
            const isOpen = entry.id === project?.id;
            const state = status[entry.id];
            return (
              <div key={entry.id} className={styles.projectRow}>
                <button
                  type="button"
                  className={styles.menuItem}
                  aria-current={isOpen || undefined}
                  onClick={() => (isOpen ? setOpen(false) : request({ type: "project-switch", id: entry.id }))}
                >
                  <span className={styles.menuTitle}>
                    {entry.name}
                    {isOpen && <span className={styles.current}>open</span>}
                    {state && !isOpen && (
                      <span className={styles.projectStatus} data-status={state}>
                        {STATUS_LABELS[state]}
                      </span>
                    )}
                  </span>
                  <span className={styles.projectDir}>{entry.dir}</span>
                  {entry.repo && <span className={styles.projectDir}>Product repo: {entry.repo}</span>}
                </button>
                {!isOpen && state !== "working" && state !== "waiting" && (
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
          {templateUpdate && (
            <div className={styles.projectRepo}>
              <span className={styles.projectRepoHint}>
                Basis' starter components have improved since this project began. Files nobody changed are already up to
                date; the agent brings the improvements into{" "}
                {templateUpdate.files.length === 1
                  ? "the one changed file"
                  : `${templateUpdate.files.length} changed files`}
                , in a review.
              </span>
              <div className={styles.projectRepoActions}>
                <button
                  type="button"
                  className={styles.chromeButton}
                  disabled={agentBusy}
                  onClick={() => {
                    setOpen(false);
                    send({ type: "template-update" });
                  }}
                >
                  Bring them in
                </button>
                <button type="button" className={styles.chromeButton} onClick={() => send({ type: "template-skip" })}>
                  Skip
                </button>
              </div>
            </div>
          )}
          <div className={styles.projectActions}>
            <button
              type="button"
              className={styles.chromeButton}
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
                ? "A design system of its own, with its own history and chat. It is saved in ~/.basis/workspaces (or BASIS_HOME)."
                : mode === "repo"
                  ? `The repo ${current?.name ?? "this project"} designs for. The agent reads it to match the product's look, components and terms; it never writes there.`
                  : "A Basis workspace anywhere on this computer, or an empty or new folder for Basis to set up. A folder inside a product repo links that repo, which the agent reads and never writes."}
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
                <FolderField
                  id="project-repo"
                  label="Repo folder"
                  value={dir}
                  onChange={setDir}
                  placeholder="Browse, pick a repo below, or paste its path"
                  dialogTitle="Choose the product repo"
                  suggestRepos
                />
              )}
            </>
          ) : (
            <>
              <FolderField
                id="project-dir"
                label={mode === "repo" ? "Repo folder" : "Folder"}
                value={dir}
                onChange={setDir}
                placeholder={
                  mode === "repo" ? "Browse, pick a repo below, or paste its path" : "Browse, or paste its path"
                }
                dialogTitle={
                  mode === "repo" ? "Choose the product repo" : "Choose a Basis workspace or an empty folder"
                }
                suggestRepos={mode === "repo"}
                autoFocus
              />
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
