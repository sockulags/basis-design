import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { SOURCE_FOLDERS } from "../shared/frame.ts";

/** Where Basis itself is installed: templates, contracts and node_modules live here. */
export const repoRoot = path.resolve(import.meta.dirname, "..");

export const DESIGN_FILE = "design-system.json";
/** What the agent knows about the linked product repo: where its tokens live, its components and terms. */
export const PRODUCT_FILE = "product.md";
export const COMPONENTS_DIR = "components";
export const PATTERNS_DIR = "patterns";
export const VIEWS_DIR = "views";

/** Folders of agent-owned source, one per gallery page: base components, patterns composed from them. */
export const SOURCE_DIRS: string[] = SOURCE_FOLDERS;

/** True for a workspace-relative, forward-slash path inside one of the source folders. */
export const isSourcePath = (relative: string) => SOURCE_DIRS.some((dir) => relative.startsWith(`${dir}/`));

/**
 * Where `target` really is once symlinks and junctions are followed, also when it (or folders above it) does not
 * exist yet. Null for a dangling link, which could point anywhere once something is written through it.
 */
export function realPath(target: string): string | null {
  let existing = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      lstatSync(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
  try {
    return path.join(realpathSync.native(existing), ...rest);
  } catch {
    return null;
  }
}

/**
 * The forward-slash path of `target` relative to `root` ("" for `root` itself), compared where both really are, so
 * a link inside `root` that leads out of it does not count. Null when `target` lies outside `root`.
 */
export function relativeInside(root: string, target: string): string | null {
  const from = realPath(root);
  const to = realPath(target);
  if (from === null || to === null) return null;
  const relative = path.relative(from, to);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}
