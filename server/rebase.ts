import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath, type Plugin } from "vite";

/** Suffix that marks a request for today's specimen file inside a snapshot copy. */
export const REBASE_SUFFIX = ".basis-now.tsx";
/** The id of a module today's file imports that the snapshot lacks (`\0` keeps other plugins off it). */
const MISSING = "\0basis-missing:";
/** What an import without an extension may name. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

/**
 * Serves today's version of a specimen file as if it lived in a snapshot copy
 * of the workspace: `<snapshot>/components/Tabs.specimen.basis-now.tsx` has the
 * content of `components/Tabs.specimen.tsx`, but its relative imports resolve
 * inside the snapshot. A review uses it for its "before" side when the starting
 * point lacks the block being shown (the agent added it to show a state), so
 * today's demo runs on the starting point's components and tokens.
 */
export function rebasePlugin(root: string, workspaceDir: string): Plugin {
  // Vite works with forward-slash ids, also on Windows.
  const snapshots = `${normalizePath(path.join(workspaceDir, ".basis", "snapshots"))}/`;
  const toFile = (url: string) =>
    normalizePath(url.startsWith("/@fs/") ? path.resolve(url.slice("/@fs/".length)) : path.join(root, url));
  const split = (id: string) => {
    const index = id.indexOf("?");
    return index === -1 ? [id, ""] : [id.slice(0, index), id.slice(index)];
  };

  return {
    name: "basis-rebase",
    enforce: "pre",
    resolveId(source, importer) {
      const [url, query] = split(source);
      // Today's file may import a sibling the starting point lacks (a new view's data file). Vite would fail to
      // compile it and show its error overlay; a module that throws instead fails only the import, which the review
      // already takes as "cannot run there".
      if (importer && source.startsWith(".")) {
        const [from] = split(normalizePath(importer));
        if (from!.endsWith(REBASE_SUFFIX) && from!.startsWith(snapshots)) {
          const target = path.resolve(path.dirname(from!), url!);
          const candidates = path.extname(target) ? [target] : SOURCE_EXTENSIONS.map((ext) => target + ext);
          if (!candidates.some((candidate) => existsSync(candidate))) return MISSING + normalizePath(target);
        }
      }
      if (!url!.endsWith(REBASE_SUFFIX)) return null;
      // Usually a URL; React's fast refresh imports the module by its absolute file path instead.
      const direct = normalizePath(url!);
      const file = direct.startsWith(snapshots) ? direct : toFile(url!);
      return file.startsWith(snapshots) ? file + query : null;
    },
    async load(id) {
      if (id.startsWith(MISSING)) {
        const file = id.slice(MISSING.length);
        return `throw new Error(${JSON.stringify(`${path.basename(file)} is not in this version of the workspace`)});`;
      }
      const [file] = split(normalizePath(id));
      if (!file!.endsWith(REBASE_SUFFIX) || !file!.startsWith(snapshots)) return null;
      // <snapshots>/<commit>/<folder>/<name>.basis-now.tsx → <workspace>/<folder>/<name>.tsx
      const [, folder, name] = file!.slice(snapshots.length).split("/");
      if (!folder || !name) return null;
      return readFile(path.join(workspaceDir, folder, name.slice(0, -REBASE_SUFFIX.length) + ".tsx"), "utf8");
    },
  };
}
