import path from "node:path";
import type { CaptureShot } from "../shared/capture.ts";
import { COLOR_ROLES, componentTokens, globalTokenGroups, kebab, type Design } from "../shared/design.ts";
import { barrel, exportedNames, imports } from "./reach.ts";

/*
 * Implementation notes for the verification kit: what the agent building a view in the product needs besides the
 * screenshots. Read from the view's source without an agent turn, so the notes always match the screenshots: its
 * screens, where each screen's literal go() calls lead, the components and patterns it imports, and the tokens
 * those files use.
 */

/** A screen another one leads to with a literal `go("id")`, and the text of the element that calls it, if any. */
export interface FlowLink {
  to: string;
  label?: string;
  /** True when the call passes data to the next screen (`go("member", member)`). */
  data: boolean;
}

/** A name a view imports from the workspace, and the file that defines it. */
export interface UsedName {
  name: string;
  file: string;
}

/** What a view's source says, for its notes. */
export interface ViewSource {
  file: string;
  description?: string;
  /** For each screen id, where its literal go() calls lead. */
  flow: Record<string, FlowLink[]>;
  components: UsedName[];
  patterns: UsedName[];
  /** Data and helpers from other files (`MEMBERS` from patterns/specimen-data.ts). */
  data: UsedName[];
  images: string[];
  /** Every workspace file the view reaches through its imports, itself included, barrels left out. */
  files: string[];
  /** The CSS variables those files read. */
  vars: string[];
}

const ASSET = /\.(svg|png|jpe?g|webp|avif|gif)$/i;
/** Gallery plumbing every view imports (defineSpecimen, ScreenProps): not part of what is built. */
const PLUMBING = /(^|\/)specimen\.ts$|\.specimen\.tsx$/;
const NAME = /[A-Za-z_$][\w$]*/;

/** The index just past the bracket that closes the one at `open`, skipping strings; the text's end if unclosed. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'" || char === "`") {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === "\\") i++;
    } else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char) && --depth === 0) return i + 1;
  }
  return text.length;
}

/** The elements of an array literal's content at its own depth, as text. */
function elements(content: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "{") continue;
    const end = closing(content, i);
    found.push(content.slice(i, end));
    i = end - 1;
  }
  return found;
}

/**
 * Top-level declarations by name, each with its text up to the next top-level statement. Formatted source starts
 * those at the line's start, which is all this relies on.
 */
function declarations(text: string): Map<string, string> {
  const starts = [...text.matchAll(/^(?:export|function|const|let|var|class|async|import|type|interface)\b/gm)].map(
    (match) => match.index,
  );
  const found = new Map<string, string>();
  starts.forEach((start, index) => {
    const chunk = text.slice(start, starts[index + 1] ?? text.length);
    const name =
      /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/.exec(
        chunk,
      )?.[1];
    if (name) found.set(name, chunk);
  });
  return found;
}

/** The literal go() calls in a piece of source, with the text of the element whose handler makes each. */
function links(text: string): FlowLink[] {
  const found: FlowLink[] = [];
  for (const match of text.matchAll(/\bgo\(\s*(["'`])([\w.:-]+)\1\s*(,?)/g)) {
    const data = match[3] === ",";
    // Past the call's closing parenthesis: `go("x", item)` ends where its bracket does.
    const end = closing(text, text.indexOf("(", match.index));
    const label = /^\s*\}\s*>\s*([^<>{}]+?)\s*</.exec(text.slice(end))?.[1]?.replace(/\s+/g, " ").trim();
    if (!found.some((link) => link.to === match[2] && link.label === label))
      found.push({ to: match[2]!, label: label || undefined, data });
  }
  return found;
}

/**
 * Where each screen of a view leads, from the literal go() calls in the function that renders it (or the inline
 * render) and in the file's other top-level functions that one uses. A screen id built at run time is not seen.
 */
export function screenFlow(text: string): Record<string, FlowLink[]> {
  const decls = declarations(text);
  const flow: Record<string, FlowLink[]> = {};
  for (const match of text.matchAll(/\bscreens\s*:\s*\[/g)) {
    const open = match.index + match[0].length - 1;
    for (const element of elements(text.slice(open + 1, closing(text, open) - 1))) {
      const id = /\bid\s*:\s*(["'`])([^"'`]+)\1/.exec(element)?.[2];
      if (!id) continue;
      const render = new RegExp(`\\brender\\s*:\\s*(${NAME.source})\\s*(?:[,}]|$)`).exec(element)?.[1];
      const seen = new Set<string>();
      const texts: string[] = [];
      const queue = render && decls.has(render) ? [render] : [];
      if (!queue.length) texts.push(element);
      while (queue.length) {
        const name = queue.pop()!;
        if (seen.has(name)) continue;
        seen.add(name);
        const body = decls.get(name)!;
        texts.push(body);
        for (const other of decls.keys())
          if (!seen.has(other) && new RegExp(`\\b${other.replace(/\$/g, "\\$")}\\b`).test(body)) queue.push(other);
      }
      flow[id] = links(texts.join("\n"));
    }
  }
  return flow;
}

/** The workspace file an import names, trying the usual extensions when it has none. */
function resolveImport(sources: Map<string, string>, from: string, target: string): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.ts`].find((file) => sources.has(file));
}

/** The files that define `names` behind an import of `file`: through a barrel by name, else the file itself. */
function definers(sources: Map<string, string>, file: string, names: string[] | null): UsedName[] {
  const reexported = barrel(sources.get(file), file);
  if (!reexported) return (names ?? ["*"]).map((name) => ({ name, file }));
  if (!names) return reexported.map((source) => ({ name: "*", file: source }));
  return names.flatMap((name) => {
    const source = reexported.find((candidate) => exportedNames(sources.get(candidate) ?? "").has(name));
    return source ? [{ name, file: source }] : [];
  });
}

/** Reads what a view uses from the workspace's sources (workspace-relative paths, as `readSources` gives them). */
export function readView(sources: Map<string, string>, file: string): ViewSource {
  const text = sources.get(file) ?? "";
  const description = /defineSpecimen\(\s*\{[\s\S]*?\bdescription\s*:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/.exec(
    text,
  )?.[2];

  // The view's own files: itself and what it imports from views/ (helpers, data, parts of screens).
  const own = new Set<string>();
  const queue = [file];
  const used = { components: [] as UsedName[], patterns: [] as UsedName[], data: [] as UsedName[] };
  const images = new Set<string>();
  while (queue.length) {
    const current = queue.pop()!;
    if (own.has(current)) continue;
    own.add(current);
    for (const { target, names } of imports(sources.get(current) ?? "")) {
      const resolved = resolveImport(sources, current, target);
      if (!resolved) continue;
      if (ASSET.test(resolved)) {
        images.add(resolved);
        continue;
      }
      if (resolved.endsWith(".css")) continue;
      if (resolved.startsWith("views/") && !barrel(sources.get(resolved), resolved)) {
        queue.push(resolved);
        continue;
      }
      for (const name of definers(sources, resolved, names)) {
        if (PLUMBING.test(name.file)) continue;
        const kind = !name.file.endsWith(".tsx")
          ? used.data
          : name.file.startsWith("components/")
            ? used.components
            : name.file.startsWith("patterns/")
              ? used.patterns
              : used.data;
        if (!kind.some((item) => item.name === name.name && item.file === name.file)) kind.push(name);
      }
    }
  }

  // Everything it reaches, for the copy of its source and the tokens it reads.
  const files = new Set<string>();
  const next = [file];
  while (next.length) {
    const current = next.pop()!;
    if (files.has(current)) continue;
    files.add(current);
    if (ASSET.test(current) || current.endsWith(".css")) continue;
    for (const { target, names } of imports(sources.get(current) ?? "")) {
      const resolved = resolveImport(sources, current, target);
      if (resolved) next.push(...definers(sources, resolved, names).map((item) => item.file));
    }
  }
  const vars = new Set<string>();
  for (const reached of files)
    for (const match of (sources.get(reached) ?? "").matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(match[1]!);

  const byName = (a: UsedName, b: UsedName) => a.name.localeCompare(b.name);
  return {
    file,
    description: description?.replace(/\\(.)/g, "$1"),
    flow: screenFlow(text),
    components: used.components.sort(byName),
    patterns: used.patterns.sort(byName),
    data: used.data.sort(byName),
    images: [...images].sort(),
    files: [...files].sort(),
    vars: [...vars].sort(),
  };
}

/** A token as the notes list it: its CSS variable, where it is in design.json, and its value (light / dark for colours). */
export interface TokenRow {
  variable: string;
  path: string;
  value: string;
  /** The component's group, for a component token (`components.button.radius`). */
  component?: string;
}

/**
 * The design's tokens behind the given CSS variables and the tokens their values refer to, sorted by variable;
 * variables that are not tokens are left out.
 */
export function tokenRows(design: Design, vars: string[]): TokenRow[] {
  const rows = new Map<string, TokenRow>();
  for (const [prefix, tokens, group] of globalTokenGroups(design)) {
    for (const [key, value] of Object.entries(tokens)) {
      const variable = `--${prefix}-${kebab(key)}`;
      rows.set(variable, { variable, path: `${group}.${key}`, value });
    }
  }
  for (const role of COLOR_ROLES) {
    const variable = `--color-${kebab(role)}`;
    rows.set(variable, {
      variable,
      path: `color.light.${role}, color.dark.${role}`,
      value: `${design.color.light[role]} / ${design.color.dark[role]}`,
    });
  }
  for (const token of componentTokens(design)) {
    rows.set(token.cssVar, {
      variable: token.cssVar,
      path: `components.${token.component}.${token.key}`,
      value: token.value,
      component: token.component,
    });
  }
  // A token set to var(--other) uses that one too (`--button-radius: var(--radius-md)`).
  const used = new Set<string>();
  const queue = [...vars];
  while (queue.length) {
    const variable = queue.pop()!;
    const row = rows.get(variable);
    if (!row || used.has(variable)) continue;
    used.add(variable);
    for (const match of row.value.matchAll(/var\(\s*(--[\w-]+)/g)) queue.push(match[1]!);
  }
  return [...used].sort().map((variable) => rows.get(variable)!);
}

/** A view as the kit's manifest has it. */
export interface NotedView {
  id: string;
  title: string;
  screens: { id: string; label: string; shots: (CaptureShot & { file?: string })[] }[];
}

const code = (text: string) => `\`${text}\``;

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function shotsLine(shots: (CaptureShot & { file?: string })[]): string {
  const widths = list([...new Set(shots.map((shot) => `${shot.width}`))]);
  const height = shots[0]?.fullPage === false ? `${shots[0].viewportHeight} px tall` : "full page";
  const themes = list([...new Set(shots.map((shot) => shot.theme))]);
  return `${widths} px wide, ${height}, ${themes}`;
}

function usedLine(items: UsedName[]): string {
  const byFile = new Map<string, string[]>();
  for (const item of items) byFile.set(item.file, [...(byFile.get(item.file) ?? []), item.name]);
  return [...byFile]
    .map(
      ([file, names]) =>
        `${names.map((name) => (name === "*" ? "everything" : code(name))).join(", ")} (${code(file)})`,
    )
    .join("; ");
}

/** The notes for one view, `views/<view>.md` in the kit. `kit` is the kit's folder as seen from the repo root. */
export function viewNotes(view: NotedView, source: ViewSource, design: Design, kit: string): string {
  const ids = new Set(view.screens.map((screen) => screen.id));
  const from = (id: string) =>
    view.screens.filter((screen) => source.flow[screen.id]?.some((link) => link.to === id)).map((s) => code(s.id));
  const screens = view.screens.map((screen, index) => {
    const leads = (source.flow[screen.id] ?? []).map((link) => {
      const detail = [link.label ? `"${link.label}"` : "", link.data ? "passes data" : ""].filter(Boolean).join(", ");
      const unknown = ids.has(link.to) ? "" : " (no such screen)";
      return `${code(link.to)}${unknown}${detail ? ` (${detail})` : ""}`;
    });
    const reached = from(screen.id);
    return [
      `### ${code(screen.id)}: ${screen.label}${index === 0 ? " (the first screen)" : ""}`,
      "",
      `- Shots: ${shotsLine(screen.shots)}. ${screen.shots
        .flatMap((shot) => (shot.file ? [code(`${kit}/${shot.file}`)] : []))
        .join(", ")}`,
      `- In the design: ${code(`${kit}/design/index.html?view=${view.id}&screen=${screen.id}&theme=light`)}`,
      `- Leads to: ${leads.length ? list(leads) : "nothing (no literal go() call)"}`,
      `- Reached from: ${reached.length ? list(reached) : index === 0 ? "the start" : "no screen (no literal go() call)"}`,
    ].join("\n");
  });

  const rows = tokenRows(design, source.vars);
  const scales = rows.filter((row) => !row.component);
  const groups = [...new Set(rows.flatMap((row) => row.component ?? []))];
  const own = source.files.filter((file) => !ASSET.test(file));
  return `# ${view.title} (${code(view.id)})

${source.description ? `${source.description}\n\n` : ""}Written by Basis from the view's source (${code(source.file)}). The source of the
view and of everything it uses is in ${code(`${kit}/source/`)}; read it for the exact text, structure and data.
It is the design system's code, not the product's: build the screens with the product's own components.

## Screens

Each screen is one page of the product, captured at the sizes listed. "Leads to" comes from the literal
\`go("<screen>")\` calls in the screen's code: the element with that text (or handler) moves to that screen.

${screens.join("\n\n")}

## What it is built from

- Components: ${source.components.length ? usedLine(source.components) : "none"}
- Patterns: ${source.patterns.length ? usedLine(source.patterns) : "none"}
- Data and helpers: ${source.data.length ? usedLine(source.data) : "none"}
- Images: ${source.images.length ? `${source.images.map(code).join(", ")}: placeholders marked \`data-basis-media\`; the product's images take their place, marked the same way` : "none"}
- Files it reaches (copied to ${code(`${kit}/source/`)}): ${own.map((file) => code(file)).join(", ")}

## Tokens

The design's tokens these files read, with the values in ${code(`${kit}/design/design.json`)}. Use the product's
tokens that hold the same values; where the product has none, use the value. A file that holds several
components brings the tokens of all of them, so not every one is on these screens.

${
  scales.length
    ? `| Variable | In design.json | Value |\n| --- | --- | --- |\n${scales
        .map((row) => `| ${code(row.variable)} | ${code(row.path)} | ${code(row.value.replace(/\|/g, "\\|"))} |`)
        .join("\n")}`
    : "None."
}

Component tokens (${code("components.<group>")} in design.json, each group's keys as ${code("--<group>-<key>")}): ${
    groups.length ? groups.map((group) => code(group)).join(", ") : "none"
  }.
`;
}
