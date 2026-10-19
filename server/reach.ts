import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Design } from "../shared/design.ts";
import { baseVars, colorVars } from "../shared/tokens.ts";
import { SOURCE_DIRS } from "./paths.ts";

/*
 * Which gallery sections a change can reach, so a review's "also changed"
 * check renders those instead of every section twice. A section is reached
 * when its specimen file, directly or through its imports, uses a changed
 * source file or a CSS variable whose value changed.
 */

/**
 * Variables Basis' own gallery sets on the design system's root (and on the
 * review's panes): every component inherits them, so a change to one reaches
 * everything. Kept in step with Preview.module.css `.root` and Review.module.css `.pane`.
 */
const INHERITED = ["--font-sans", "--color-text", "--color-bg", "--text-base", "--leading-normal"];

const SOURCE = /\.(tsx?|css)$/;
/** Images a source file may import (a view's placeholders in views/assets/): reached like code, never read. */
const ASSET = /\.(svg|png|jpe?g|webp|avif|gif)$/i;

/**
 * The specimen files (`components/Button.specimen.tsx`) a change can reach, or
 * null when it can reach everything. `files` are the changed source files,
 * workspace-relative with forward slashes.
 */
export async function reachedSpecimens(
  dir: string,
  files: string[],
  before: Design,
  after: Design,
): Promise<string[] | null> {
  const vars = changedVars(before, after);
  if (INHERITED.some((name) => vars.has(name))) return null;
  const sources = await readSources(dir);
  const seeds = new Set(files.filter((file) => sources.has(file)));
  if (vars.size) {
    for (const [file, text] of sources) if (usesAny(text, vars)) seeds.add(file);
  }
  const importers = importerGraph(sources);
  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...(importers.get(file) ?? []));
  }
  return [...reached].filter((file) => file.endsWith(".specimen.tsx")).sort();
}

/** CSS variables whose value differs between two designs, in either theme, plus every variable that refers to one. */
export function changedVars(before: Design, after: Design): Set<string> {
  const values = (design: Design) => {
    const map = new Map<string, string>();
    for (const [name, value] of baseVars(design)) map.set(name, value);
    for (const theme of ["light", "dark"] as const) {
      for (const [name, value] of colorVars(design, theme)) map.set(`${name}|${theme}`, value);
    }
    return map;
  };
  const a = values(before);
  const b = values(after);
  const changed = new Set<string>();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) changed.add(key.split("|")[0]!);
  }
  // A token set to var(--other) changes whenever --other does.
  const references = new Map<string, string[]>();
  for (const [key, value] of b) {
    const name = key.split("|")[0]!;
    const used = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);
    references.set(name, [...(references.get(name) ?? []), ...used]);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, used] of references) {
      if (!changed.has(name) && used.some((other) => changed.has(other))) {
        changed.add(name);
        grew = true;
      }
    }
  }
  return changed;
}

function usesAny(text: string, vars: Set<string>): boolean {
  for (const match of text.matchAll(/--[\w-]+/g)) if (vars.has(match[0])) return true;
  return false;
}

export async function readSources(dir: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const folder of SOURCE_DIRS) {
    let names: string[];
    try {
      names = (await readdir(path.join(dir, folder), { recursive: true })).map(String);
    } catch {
      continue;
    }
    for (const name of names) {
      const asset = ASSET.test(name);
      if (!SOURCE.test(name) && !asset) continue;
      const file = `${folder}/${name.split(path.sep).join("/")}`;
      sources.set(file, asset ? "" : await readFile(path.join(dir, folder, name), "utf8").catch(() => ""));
    }
  }
  return sources;
}

/** For every source file, the files that import it (through barrels by name where they say which names). */
export function importerGraph(sources: Map<string, string>): Map<string, string[]> {
  const exportsOf = new Map<string, Set<string>>();
  for (const [file, text] of sources) exportsOf.set(file, exportedNames(text));
  const importers = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    if (!sources.has(to)) return;
    importers.set(to, [...(importers.get(to) ?? []), from]);
  };
  for (const [file, text] of sources) {
    // A barrel's own `export * from` lines are not uses: following them back would make every module that
    // imports the barrel depend on every file in it.
    if (file.endsWith(".css") || barrel(text, file)) continue;
    for (const { target, names } of imports(text)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      link(file, resolved);
      const reexported = barrel(sources.get(resolved), resolved);
      if (!reexported) continue;
      // Through a barrel, depend on the files defining the names imported, or on all of it when that is unclear.
      const definers = (name: string) => reexported.filter((source) => exportsOf.get(source)?.has(name));
      const clear = names !== null && names.every((name) => definers(name).length > 0);
      for (const source of clear ? names.flatMap(definers) : reexported) link(file, source);
    }
  }
  return importers;
}

/**
 * Relative imports and re-exports, with the runtime names they bring in when
 * they list them. Types never change what renders, so type-only imports and
 * `type X` names are left out.
 */
export function imports(text: string): { target: string; names: string[] | null }[] {
  const found: { target: string; names: string[] | null }[] = [];
  for (const match of text.matchAll(/(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["'](\.[^"']+)["']/g)) {
    if (match[1]) continue;
    const clause = match[2] ?? "";
    const braces = /\{([^}]*)\}/.exec(clause);
    const names =
      braces && !clause.replace(braces[0], "").replace(/[\s,]/g, "")
        ? braces[1]!
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item && !item.startsWith("type "))
            .map((item) => item.split(/\s+as\s+/)[0]!)
        : null;
    found.push({ target: match[3]!, names });
  }
  for (const match of text.matchAll(/import\s+["'](\.[^"']+)["']/g)) found.push({ target: match[1]!, names: null });
  return found;
}

/** The files a barrel (a module of only `export * from` lines) re-exports, or null for any other module. */
export function barrel(text: string | undefined, file: string): string[] | null {
  if (text === undefined) return null;
  const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = code.split("\n").filter((line) => line.trim());
  const targets = lines.map((line) => /^\s*export\s+\*\s+from\s+["'](\.[^"']+)["'];?\s*$/.exec(line)?.[1]);
  if (!targets.length || targets.some((target) => !target)) return null;
  return targets.map((target) => path.posix.normalize(path.posix.join(path.posix.dirname(file), target!)));
}

/** Names a module exports by declaration or in an export list. */
export function exportedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(
    /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]!);
  }
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const item of match[1]!.split(",")) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.replace(/^type\s+/, "");
      if (name) names.add(name);
    }
  }
  return names;
}
