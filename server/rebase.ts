import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath, type Plugin } from "vite";

/** Suffix that marks a request for today's specimen file inside a snapshot copy. */
export const REBASE_SUFFIX = ".basis-now.tsx";

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
    resolveId(source) {
      const [url, query] = split(source);
      if (!url!.endsWith(REBASE_SUFFIX)) return null;
      const file = toFile(url!);
      return file.startsWith(snapshots) ? file + query : null;
    },
    async load(id) {
      const [file] = split(normalizePath(id));
      if (!file!.endsWith(REBASE_SUFFIX) || !file!.startsWith(snapshots)) return null;
      // <snapshots>/<commit>/<folder>/<name>.basis-now.tsx → <workspace>/<folder>/<name>.tsx
      const [, folder, name] = file!.slice(snapshots.length).split("/");
      if (!folder || !name) return null;
      return readFile(path.join(workspaceDir, folder, name.slice(0, -REBASE_SUFFIX.length) + ".tsx"), "utf8");
    },
  };
}
