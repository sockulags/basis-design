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

/*
 * The Explorer-style folder dialog (IFileOpenDialog with FOS_PICKFOLDERS). FolderBrowserDialog is the old tree
 * picker in Windows PowerShell 5.1, so the dialog is reached through a little COM interop compiled by Add-Type, in
 * C# old enough for 5.1's compiler. Only the methods up to GetResult are declared; the rest of the interface
 * follows them. A hidden, topmost owner window keeps the dialog in front of the browser.
 */
const WINDOWS_DIALOG = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BasisFolderDialog {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}

  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid riid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid riid, out IShellItem item);

  private const uint PICK_FOLDERS = 0x20, FORCE_FILESYSTEM = 0x40, NO_CHANGE_DIR = 0x8, PATH_MUST_EXIST = 0x800;
  private const uint FILESYSTEM_PATH = 0x80058000;

  public static string Pick(IntPtr owner, string title, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | PICK_FOLDERS | FORCE_FILESYSTEM | NO_CHANGE_DIR | PATH_MUST_EXIST);
    dialog.SetTitle(title);
    try {
      Guid shellItem = typeof(IShellItem).GUID;
      IShellItem folder;
      SHCreateItemFromParsingName(start, IntPtr.Zero, ref shellItem, out folder);
      dialog.SetFolder(folder);
    } catch (Exception) {}
    if (dialog.Show(owner) != 0) return null;
    IShellItem result;
    dialog.GetResult(out result);
    string chosen;
    result.GetDisplayName(FILESYSTEM_PATH, out chosen);
    return chosen;
  }
}
'@
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }
$owner.Show()
$chosen = [BasisFolderDialog]::Pick($owner.Handle, $env:BASIS_TITLE, $env:BASIS_START)
if ($chosen) { [Console]::Out.Write($chosen) }
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
