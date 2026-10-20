import assert from "node:assert/strict";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { strToU8 } from "fflate";
import type { CaptureList } from "../shared/capture.ts";
import type { VerifyKitSummary } from "../shared/protocol.ts";
import { basisPlugin, pendingComment, viewIdFor, type BasisHookContext } from "../integrations/the-factory/basis.ts";
import { handlePipelineApi, type ApiOptions, type ApiProject } from "../server/api.ts";
import { Verifications } from "../server/diff.ts";
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
    workspace: {
      review: null as { show: { specimen: string }[]; files: string[] } | null,
      dir: "/nowhere",
      state: { design: DEFAULT_DESIGN },
    },
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
    verify: async () => null,
    verifications: new Verifications(path.join(root, "verifications")),
    reportPath: () => "",
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
  /** The card's history, as The Factory keeps it. */
  const events: { id: string; kind: string; payload: unknown }[] = [];
  const context = (): BasisHookContext => ({
    card: { id: "c1", key: "WEB-12", title: "Audit log", body: "Admins see who signed in.", worktreePath: worktree },
    step: { id: "screens" },
    board: { addLink: async (link) => void links.push(link), events: async () => events },
    runner: { exec: run, commitAll: async (_, message) => (commits.push(message), "abc123") },
    config: plugin.config.parse({ url, project: "Auth-service", appUrl: "http://basis.internal:5320" }),
    env: { BASIS_API_TOKEN: TOKEN },
  });

  test("starts the view for the card once, and links the card to Basis", async () => {
    const first = await plugin.hooks["design.start_view"](context());
    assert.deepEqual(first, { view: "web-12", started: true, thread: "t-1", forwarded: null });
    assert.match(turns[0]!, /^New view: AuditLog \(WEB-12\)\n\nAudit log\n\nAdmins see who signed in\.$/);
    assert.deepEqual(links[0], {
      cardId: "c1",
      plugin: "basis",
      kind: "design",
      ref: "web-12",
      url: "http://basis.internal:5320",
      title: "WEB-12 in Basis",
    });
    // Entered again without a comment (a retry): no second turn.
    views.add("web-12");
    const again = await plugin.hooks["design.start_view"](context());
    assert.equal(again.started, false);
    assert.equal(turns.length, 1);
  });

  test("sends the reviewer's comment to Basis as a change to the view, once", async () => {
    events.push(
      {
        id: "e1",
        kind: "gate_decided",
        payload: { step: "spec", decision: "changes_requested", comment: "Not this one" },
      },
      {
        id: "e2",
        kind: "gate_decided",
        payload: { step: "screens", decision: "changes_requested", comment: " Add the IP address. " },
      },
    );
    const entered = await plugin.hooks["design.start_view"](context());
    assert.deepEqual(entered, { view: "web-12", started: false, thread: "t-1", forwarded: "e2" });
    assert.equal(turns.at(-1), "Changes to web-12\n\nAdd the IP address.");
    // The Factory records the hook's result; entering again (a retry) does not send it twice.
    events.push({
      id: "e3",
      kind: "hook_ran",
      payload: { hook: "design.start_view", phase: "enter", result: entered },
    });
    const count = turns.length;
    assert.equal((await plugin.hooks["design.start_view"](context())).forwarded, null);
    assert.equal(turns.length, count);
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

  test("waits for the review in Basis to be approved, unless told not to", async () => {
    project.workspace.review = { show: [{ specimen: "web-12" }], files: [] };
    await assert.rejects(plugin.hooks["design.fetch_kit"](context()), /WEB-12 is still in review in Basis/);
    const relaxed = { ...context(), config: { ...context().config, requireApproval: false } };
    assert.equal((await plugin.hooks["design.fetch_kit"](relaxed)).view, "web-12");
    project.workspace.review = null;
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

test("the comment to send is the step's latest change request, with text, not sent before", () => {
  const decided = (id: string, step: string, comment: string | null) => ({
    id,
    kind: "gate_decided",
    payload: { step, decision: "changes_requested", comment },
  });
  assert.equal(pendingComment([], "screens"), null);
  assert.equal(pendingComment([decided("a", "screens", "  ")], "screens"), null);
  assert.equal(pendingComment([decided("a", "spec", "x")], "screens"), null);
  assert.deepEqual(pendingComment([decided("a", "screens", "x"), decided("b", "screens", "y")], "screens"), {
    id: "b",
    text: "y",
  });
  const approved = { id: "c", kind: "gate_decided", payload: { step: "screens", decision: "approved", comment: "ok" } };
  assert.deepEqual(pendingComment([decided("a", "screens", "x"), approved], "screens"), { id: "a", text: "x" });
});
