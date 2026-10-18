import { useEffect, useState } from "react";
import styles from "./Shell.module.css";

/*
 * Choosing a folder without typing its path: the operating system's own folder dialog, opened by the Basis server
 * (it runs on this computer), and the git repos it finds in the usual places for code.
 */

async function api<T>(path: string, body: object = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Basis answered ${response.status}`);
  return (await response.json()) as T;
}

interface BrowseButtonProps {
  /** The title of the system's folder dialog. */
  title: string;
  /** Where the dialog starts; the user's home folder when empty or missing. */
  start: string;
  onPick: (path: string) => void;
  onError: (message: string | null) => void;
}

/** Opens the system's folder dialog; the folder the user chooses fills the field. */
export function BrowseButton({ title, start, onPick, onError }: BrowseButtonProps) {
  const [open, setOpen] = useState(false);
  const browse = async () => {
    setOpen(true);
    onError(null);
    try {
      const answer = await api<{ path: string | null; error?: string }>("/api/pick-folder", { title, start });
      if (answer.path) onPick(answer.path);
      if (answer.error) onError(answer.error);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setOpen(false);
    }
  };
  return (
    <button type="button" className={styles.chromeButton} onClick={() => void browse()} disabled={open}>
      {open ? "Choose in the dialog…" : "Browse…"}
    </button>
  );
}

interface RepoSuggestion {
  name: string;
  dir: string;
}

interface FolderFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder: string;
  /** The title of the system's folder dialog. */
  dialogTitle: string;
  /** Offers the git repos found on this computer, the most recently used first. */
  suggestRepos?: boolean;
  autoFocus?: boolean;
}

/** A folder path: typed or pasted, chosen in the system's dialog, or picked from the repos Basis found. */
export function FolderField({
  id,
  label,
  value,
  onChange,
  placeholder,
  dialogTitle,
  suggestRepos = false,
  autoFocus,
}: FolderFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoSuggestion[]>([]);

  useEffect(() => {
    if (!suggestRepos) return;
    let current = true;
    api<{ repos: RepoSuggestion[] }>("/api/repos")
      .then((answer) => current && setRepos(answer.repos))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [suggestRepos]);

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className={styles.folderRow}>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        <BrowseButton title={dialogTitle} start={value} onPick={onChange} onError={setError} />
      </div>
      {error && <p className={styles.kitError}>{error}</p>}
      {repos.length > 0 && (
        <div className={styles.repoSuggestions} role="group" aria-label="Repos on this computer">
          <span className={styles.muted}>Repos on this computer</span>
          <div>
            {repos.slice(0, 8).map((repo) => (
              <button
                key={repo.dir}
                type="button"
                className={styles.repoChip}
                aria-pressed={value === repo.dir}
                title={repo.dir}
                onClick={() => onChange(repo.dir)}
              >
                {repo.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
