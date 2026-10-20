import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { strToU8 } from "fflate";
import type { CaptureList } from "../shared/capture.ts";
import type { VerifyKitSummary } from "../shared/protocol.ts";
import { basisPlugin, viewIdFor, type BasisHookContext } from "../integrations/the-factory/basis.ts";
import { handlePipelineApi, type ApiOptions, type ApiProject } from "../server/api.ts";
import { zipVerificationKit } from "../server/verify.ts";

const TOKEN = "factory-test-token";

/** Runs a command the way the Factory's runner does: in a shell, in the worktree, with the runner's env. */
function run(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, BASIS_API_TOKEN: TOKEN } });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

describe("the Factory plugin against Basis' API", () => {
  const root = path.join(tmpdir(), `basis-factory-${process.pid}`);
  const worktree = path.join(root, "worktree");
  // Basis' side: a project whose agent records turns and whose views appear once a turn is asked for.
  const views = new Set<string>();
  const turns: string[] = [];
  let agent: "idle" | "working" = "idle";
  /** What the next kit holds, besides its prompt. */
  let extra: { path: string; data: Uint8Array }[] = [];
  const list = (): CaptureList => ({
    specimens: [],
    widths: [375],
    problems: [],
    views: [...views].map((id) => ({ id, title: id, file: "", screens: [{ id: "main", label: "Main", shots: [] }] })),
  });
  const project: ApiProject = {
    entry: { id: "auth-service", name: "Auth-service", dir: "/ws" },
    get busy() {
      return agent === "working";
    },
    waiting: false,
    agent: {
      whenReady: async () => true,
      newThread: () => "t-1",
      prompt: async (text) => void turns.push(text),
    },
    screenshots: { list: async () => list() },
  };
  const options: ApiOptions = {
    token: TOKEN,
    projects: () => [project.entry],
    open: async () => project,
    buildKit: async (_, request) => ({
      files: [{ path: "PROMPT.md", data: strToU8(`kit of ${request.views?.join(",")}`) }, ...extra],
      summary: { folder: request.folder!, shots: 1 } as VerifyKitSummary,
    }),
    zip: zipVerificationKit,
  };
  let server: http.Server;
  let url = "";
  before(async () => {
    await mkdir(worktree, { recursive: true });
    server = http.createServer((req, res) => void handlePipelineApi(req, res, options));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  const plugin = basisPlugin();
  const links: unknown[] = [];
  const commits: string[] = [];
  const context = (): BasisHookContext => ({
    card: { id: "c1", key: "WEB-12", title: "Audit log", body: "Admins see who signed in.", worktreePath: worktree },
    board: { addLink: async (link) => void links.push(link) },
    runner: { exec: run, commitAll: async (_, message) => (commits.push(message), "abc123") },
    config: plugin.config.parse({ url, project: "Auth-service", appUrl: "http://basis.internal:5320" }),
    env: { BASIS_API_TOKEN: TOKEN },
  });

  test("starts the view for the card once, and links the card to Basis", async () => {
    const first = await plugin.hooks["design.start_view"](context());
    assert.deepEqual(first, { view: "web-12", started: true, thread: "t-1" });
    assert.match(turns[0]!, /^New view: AuditLog \(WEB-12\)\n\nAudit log\n\nAdmins see who signed in\.$/);
    assert.deepEqual(links[0], {
      cardId: "c1",
      plugin: "basis",
      kind: "design",
      ref: "web-12",
      url: "http://basis.internal:5320",
      title: "WEB-12 in Basis",
    });
    // Entered again after "changes requested": the designer goes on in Basis, no second turn.
    views.add("web-12");
    const again = await plugin.hooks["design.start_view"](context());
    assert.equal(again.started, false);
    assert.equal(turns.length, 1);
  });

  test("brings the kit into the worktree and commits it, keeping the project's own files", async () => {
    const kit = path.join(worktree, "basis-verify", "web-12");
    await mkdir(path.join(kit, "screens"), { recursive: true });
    await writeFile(path.join(kit, "targets.json"), '{ "mine": true }');
    await writeFile(path.join(kit, "screens", "stale.png"), "old");
    extra = [{ path: "screens/main/main@375.png", data: new Uint8Array([137, 80, 78, 71]) }];
    const result = await plugin.hooks["design.fetch_kit"](context());
    assert.deepEqual(result, { view: "web-12", screens: 1, folder: "basis-verify/web-12", commit: "abc123" });
    assert.equal(await readFile(path.join(kit, "PROMPT.md"), "utf8"), "kit of web-12");
    assert.deepEqual([...(await readFile(path.join(kit, "screens", "main", "main@375.png")))], [137, 80, 78, 71]);
    await assert.rejects(readFile(path.join(kit, "screens", "stale.png")), "the kit's screens replace the old ones");
    assert.equal(await readFile(path.join(kit, "targets.json"), "utf8"), '{ "mine": true }');
    assert.deepEqual(commits, ["WEB-12 Design: verification kit from Basis"]);
  });

  test("waits for Basis: no view yet, or its agent still working", async () => {
    views.clear();
    await assert.rejects(plugin.hooks["design.fetch_kit"](context()), /Basis has no view web-12 yet/);
    views.add("web-12");
    agent = "working";
    await assert.rejects(plugin.hooks["design.fetch_kit"](context()), /agent is working on web-12/);
    agent = "idle";
  });

  test("refuses a kit with a file outside its folder", async () => {
    extra = [{ path: "../../escaped.txt", data: strToU8("no") }];
    await assert.rejects(plugin.hooks["design.fetch_kit"](context()), /outside basis-verify\/web-12\//);
    await assert.rejects(readFile(path.join(worktree, "escaped.txt")));
    extra = [];
  });

  test("needs the token on the server", async () => {
    await assert.rejects(plugin.hooks["design.start_view"]({ ...context(), env: {} }), /BASIS_API_TOKEN is not set/);
  });
});

test("the card key becomes the view's id as Basis makes it", () => {
  assert.equal(viewIdFor("WEB-12"), "web-12");
  assert.equal(viewIdFor("owner/repo#42"), "owner-repo-42");
});
