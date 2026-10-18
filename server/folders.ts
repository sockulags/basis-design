import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
 * Choosing folders without typing their path: the operating system's own folder dialog (Basis runs on the same
 * computer as the browser), and the git repos found in the usual places for code.
 */

/** The folder the user chose, or null when they cancelled. Throws when this system has no folder dialog. */
export async function pickFolder(title: string, start?: string): Promise<string | null> {
  const from = start && existsSync(start) ? start : os.homedir();
  // Title and start folder travel as variables, so no quoting can break the scripts.
  const env = { ...process.env, BASIS_TITLE: title, BASIS_START: from };
  if (process.platform === "win32") {
    const shell = (await has("pwsh")) ? "pwsh" : "powershell";
    return run(shell, ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_DIALOG], env);
  }
  if (process.platform === "darwin") {
    const chosen = await run("osascript", ["-e", MAC_DIALOG], env);
    return chosen && chosen.length > 1 ? chosen.replace(/\/$/, "") : chosen;
  }
  if (await has("zenity")) {
    return run("zenity", ["--file-selection", "--directory", `--title=${title}`, `--filename=${from}/`], env);
  }
  if (await has("kdialog")) return run("kdialog", ["--getexistingdirectory", from, "--title", title], env);
  throw new Error("This system has no folder dialog Basis can open (install zenity or kdialog), so type the path.");
}

// A hidden, topmost owner window keeps the dialog in front of the browser.
const WINDOWS_DIALOG = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:BASIS_TITLE
$dialog.SelectedPath = $env:BASIS_START
try { $dialog.UseDescriptionForTitle = $true } catch {}
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }
$owner.Close()
`;

const MAC_DIALOG = `POSIX path of (choose folder with prompt (system attribute "BASIS_TITLE") default location (POSIX file (system attribute "BASIS_START")))`;

/** Runs a dialog: its output is the chosen path; cancelling exits non-zero with nothing printed. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      const chosen = stdout.trim();
      if (chosen) return resolve(chosen);
      if (error && "code" in error && typeof error.code === "string") return reject(error); // Not found, not run.
      resolve(null);
    });
  });
}

function has(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => execFile(probe, [command], { windowsHide: true }, (error) => resolve(!error)));
}

export interface RepoSuggestion {
  name: string;
  dir: string;
}

/** Folders under the home folder where people usually keep their code. */
const CODE_FOLDERS = [
  "Code",
  "code",
  "Projects",
  "projects",
  "dev",
  "Dev",
  "Developer",
  "src",
  "repos",
  "Repos",
  "git",
  "GitHub",
  "workspace",
  path.join("Documents", "GitHub"),
  path.join("source", "repos"),
];

/**
 * Git repos in the usual places for code, up to two levels down, the most recently used first (by the git index,
 * which changes with every checkout and commit). `skip` leaves out folders such as Basis' own.
 */
export async function suggestRepos(home = os.homedir(), skip: string[] = [], limit = 12): Promise<RepoSuggestion[]> {
  const found = new Map<string, number>();
  const visit = async (dir: string, depth: number) => {
    if (found.size >= 200) return;
    const git = path.join(dir, ".git");
    // The code folder itself is never the suggestion, even when someone made it a repo.
    if (depth < 2 && existsSync(git)) {
      const index = await stat(path.join(git, "index")).catch(() => stat(git));
      found.set(dir, index.mtimeMs);
      return;
    }
    if (depth === 0) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      await visit(path.join(dir, entry.name), depth - 1);
    }
  };
  // One folder once, also when a case-insensitive disk finds it as both "Code" and "code".
  const roots = new Map<string, string>();
  for (const folder of CODE_FOLDERS) {
    const dir = path.join(home, folder);
    const info = await stat(dir).catch(() => null);
    if (info?.isDirectory() && !roots.has(`${info.dev}:${info.ino}`)) roots.set(`${info.dev}:${info.ino}`, dir);
  }
  for (const root of roots.values()) await visit(root, 2);
  const skipped = skip.map((dir) => path.resolve(dir).toLowerCase());
  return [...found]
    .filter(([dir]) => !skipped.some((other) => path.resolve(dir).toLowerCase() === other))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([dir]) => ({ name: path.basename(dir), dir }));
}
