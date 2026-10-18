import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TemplateUpdate } from "../shared/protocol.ts";
import { repoRoot, SOURCE_DIRS } from "./paths.ts";

/*
 * Keeping workspaces up to date with Basis' starter template (template/). A workspace owns its copy, so Basis
 * replaces only files nobody changed: those that still match an earlier version of the template, listed in
 * template/history.json. For files the agent has changed, Basis offers a guided turn that brings in what
 * template/CHANGES.md describes, from a copy of the template in .basis/template/.
 */

/** Earlier versions of each starter file, by workspace-relative path (written by scripts/template-history.ts). */
export const TEMPLATE_HISTORY_FILE = "template/history.json";

/**
 * The version of the starter template. Raise it, with a section in template/CHANGES.md, when the template changes
 * in a way worth bringing into workspaces whose agent has changed their components.
 */
export const TEMPLATE_VERSION = 2;

/** Where a workspace records the template version it has caught up with. */
const VERSION_FILE = path.join(".basis", "template.json");

/** The copy of the current template the agent compares against during the guided turn. */
export const TEMPLATE_COPY = ".basis/template";

export function hashText(text: string): string {
  return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
}

/** The starter files, as workspace-relative forward-slash paths ("components/Button.tsx"). */
export async function templateFiles(root = repoRoot): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const names = await readdir(path.join(root, "template", dir)).catch(() => [] as string[]);
    files.push(...names.sort().map((name) => `${dir}/${name}`));
  }
  return files;
}

/**
 * The hashes of every earlier version of each starter file, read from git. Only the script that writes
 * template/history.json and its test use it; an installed Basis has no git history.
 */
export function earlierTemplateHashes(root: string): Record<string, string[]> {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const history: Record<string, string[]> = {};
  const current = git(["ls-files", ...SOURCE_DIRS.map((dir) => `template/${dir}`)])
    .split("\n")
    .filter((file) => file && file.split("/").length === 3);
  for (const file of current) {
    // The file as it is now, committed or not: the version a workspace should end up with.
    const now = hashText(readFileSync(path.join(root, file), "utf8"));
    const hashes = new Set<string>();
    for (const commit of git(["log", "--format=%H", "--", file]).split("\n").filter(Boolean)) {
      let text: string;
      try {
        text = git(["show", `${commit}:${file}`]);
      } catch {
        continue; // The commit removed the file.
      }
      const hash = hashText(text);
      if (hash !== now) hashes.add(hash);
    }
    if (hashes.size) history[file.slice("template/".length)] = [...hashes].sort();
  }
  return history;
}

/**
 * The files that belong together: a component's source, stylesheet and specimen share the part of their name
 * before the first dot ("patterns/Navbar"), and a new Navbar.tsx needs the stylesheet written for it.
 */
function unitOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return file.slice(0, slash + 1) + file.slice(slash + 1).split(".")[0];
}

/**
 * Replaces starter files that still match an earlier version of the template with the current one, a unit at a
 * time (see unitOf): a unit is updated only when none of its files was changed, so a component is never left with a
 * new source and an old stylesheet. Returns the paths it replaced. Changed or removed files are left alone.
 */
export async function updateUntouchedStarterFiles(dir: string): Promise<string[]> {
  const history = JSON.parse(await readFile(path.join(repoRoot, TEMPLATE_HISTORY_FILE), "utf8")) as Record<
    string,
    string[]
  >;
  const units = new Map<string, { file: string; current: string; ours: string }[]>();
  for (const file of await templateFiles()) {
    const target = path.join(dir, file);
    if (!existsSync(target)) continue;
    const current = (await readFile(path.join(repoRoot, "template", file), "utf8")).replaceAll("\r\n", "\n");
    const files = units.get(unitOf(file)) ?? [];
    files.push({ file, current, ours: hashText(await readFile(target, "utf8")) });
    units.set(unitOf(file), files);
  }
  const updated: string[] = [];
  for (const files of units.values()) {
    const untouched = files.every(
      ({ file, current, ours }) => ours === hashText(current) || history[file]?.includes(ours),
    );
    if (!untouched) continue;
    for (const { file, current, ours } of files) {
      if (ours === hashText(current)) continue;
      await writeFile(path.join(dir, file), current);
      updated.push(file);
    }
  }
  return updated;
}

export async function recordedTemplateVersion(dir: string): Promise<number> {
  try {
    return Number(JSON.parse(await readFile(path.join(dir, VERSION_FILE), "utf8")).version) || 0;
  } catch {
    return 0;
  }
}

export async function recordTemplateVersion(dir: string, version = TEMPLATE_VERSION): Promise<void> {
  await mkdir(path.join(dir, ".basis"), { recursive: true });
  await writeFile(path.join(dir, VERSION_FILE), `${JSON.stringify({ version })}\n`);
}

/**
 * Whether the workspace is behind the template. A workspace whose starter files all match the current template
 * has nothing to bring in, so it is recorded as caught up.
 */
export async function templateUpdate(dir: string): Promise<TemplateUpdate | null> {
  const from = await recordedTemplateVersion(dir);
  if (from >= TEMPLATE_VERSION) return null;
  const files: string[] = [];
  for (const file of await templateFiles()) {
    const target = path.join(dir, file);
    if (!existsSync(target)) continue;
    const ours = hashText(await readFile(target, "utf8"));
    if (ours !== hashText(await readFile(path.join(repoRoot, "template", file), "utf8"))) files.push(file);
  }
  if (files.length === 0) {
    await recordTemplateVersion(dir);
    return null;
  }
  return { from, to: TEMPLATE_VERSION, files };
}

/** The sections of template/CHANGES.md newer than `from`. */
export async function templateChanges(from: number): Promise<string> {
  const text = (await readFile(path.join(repoRoot, "template", "CHANGES.md"), "utf8")).replaceAll("\r\n", "\n");
  return text
    .split(/^(?=## )/m)
    .filter((section) => Number(section.match(/^## (\d+)/)?.[1] ?? 0) > from)
    .join("")
    .trim();
}

/** Copies the current template into the workspace for the guided turn to read (it is generated, not history). */
export async function writeTemplateCopy(dir: string): Promise<void> {
  const target = path.join(dir, TEMPLATE_COPY);
  await rm(target, { recursive: true, force: true });
  for (const folder of SOURCE_DIRS) {
    await cp(path.join(repoRoot, "template", folder), path.join(target, folder), { recursive: true });
  }
}
