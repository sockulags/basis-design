import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { normalizePath, type Plugin } from "vite";
import { REBASE_SUFFIX, rebasePlugin } from "../server/rebase.ts";

const workspace = await mkdtemp(path.join(tmpdir(), "basis-rebase-"));
after(() => rm(workspace, { recursive: true, force: true }));

// The starting point has the patterns and an older view; today adds a view with a data file of its own.
const snapshot = path.join(workspace, ".basis", "snapshots", "abc123");
await mkdir(path.join(snapshot, "views"), { recursive: true });
await mkdir(path.join(snapshot, "patterns"), { recursive: true });
await writeFile(path.join(snapshot, "patterns", "index.ts"), "export const Old = 1;\n");
await writeFile(path.join(snapshot, "views", "Old-data.ts"), "export const rows = [];\n");
await mkdir(path.join(workspace, "views"), { recursive: true });
await writeFile(
  path.join(workspace, "views", "Audit.specimen.tsx"),
  'import { rows } from "./audit-data.ts";\nexport default rows;\n',
);

type Hook = (this: unknown, ...args: unknown[]) => unknown;
const plugin = rebasePlugin(path.resolve("."), workspace) as Plugin & { resolveId: Hook; load: Hook };
const rebased = `${normalizePath(path.join(snapshot, "views", "Audit.specimen"))}${REBASE_SUFFIX}?v=0`;

test("today's file inside a snapshot is served from today's workspace", async () => {
  assert.match(String(await plugin.load(rebased)), /from "\.\/audit-data\.ts"/);
});

test("an import of a file the snapshot lacks fails when it runs, not when Vite compiles it", async () => {
  const id = plugin.resolveId("./audit-data.ts", rebased) as string;
  assert.ok(id.startsWith("\0"), "a module of Basis' own, which Vite never looks for on disk");
  assert.match(String(await plugin.load(id)), /^throw new Error\(".*audit-data\.ts is not in this version/);
  // Without an extension too.
  assert.ok(String(plugin.resolveId("./audit-data", rebased)).startsWith("\0"));
});

test("imports the snapshot has, and imports from other files, are left to Vite", () => {
  assert.equal(plugin.resolveId("../patterns/index.ts", rebased), null);
  assert.equal(plugin.resolveId("./Old-data", rebased), null);
  assert.equal(plugin.resolveId("react", rebased), null);
  const plain = normalizePath(path.join(snapshot, "views", "Old.specimen.tsx"));
  assert.equal(plugin.resolveId("./audit-data.ts", plain), null);
});
