import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { after, before, describe, test } from "node:test";
import { strToU8 } from "fflate";
import type { CaptureList } from "../shared/capture.ts";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import type { VerifyKitSummary } from "../shared/protocol.ts";
import { handlePipelineApi, type ApiOptions, type ApiProject } from "../server/api.ts";
import { Verifications, type DiffReport } from "../server/diff.ts";
import { zipVerificationKit } from "../server/verify.ts";

const SERVER = path.resolve(import.meta.dirname, "..", "plugins", "basis", "mcp", "basis-mcp.mjs");
const TOKEN = "mcp-test-token";

/** The MCP server as an agent runs it: a process spoken to in JSON-RPC lines. */
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
  }) as ChildProcessWithoutNullStreams;
  const waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let next = 1;
  const request = (method: string, params?: unknown) =>
    new Promise<{ result?: any; error?: { message: string } }>((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const tool = async (name: string, args: object = {}) => {
    const { result } = await request("tools/call", { name, arguments: args });
    const text = result.content[0].text as string;
    return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
  };
  return { child, request, tool };
}

describe("the Basis MCP server", () => {
  let server: http.Server;
  let url = "";
  let root = "";
  const turns: string[] = [];
  const list: CaptureList = {
    specimens: [],
    widths: [375],
    problems: [],
    views: [
      {
        id: "web-12",
        title: "WEB-12 Audit log",
        file: "views/A.specimen.tsx",
        screens: [{ id: "log", label: "Log", shots: [] }],
      },
    ],
  };
  const project: ApiProject = {
    entry: { id: "auth-service", name: "Auth-service", dir: "/ws" },
    busy: false,
    waiting: false,
    agent: { whenReady: async () => true, newThread: () => "t-9", prompt: async (text) => void turns.push(text) },
    screenshots: { list: async () => list },
    workspace: { review: null, dir: "/nowhere", state: { design: DEFAULT_DESIGN } },
  };
  let mcp: ReturnType<typeof start>;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "basis-mcp-"));
    const options: ApiOptions = {
      token: TOKEN,
      projects: () => [project.entry],
      open: async () => project,
      buildKit: async (_, request) => ({
        files: [{ path: "PROMPT.md", data: strToU8("build it") }],
        summary: { folder: request.folder!, shots: 1 } as VerifyKitSummary,
      }),
      zip: zipVerificationKit,
      verify: async (_, view, request) =>
        ({
          id: "r1",
          view: view.id,
          pass: true,
          passWithExceptions: true,
          label: request.label,
          shots: [],
        }) as unknown as DiffReport,
      verifications: new Verifications(path.join(root, "verifications")),
      reportPath: (p, id) => `/verifications/${p}/${id}`,
    };
    server = http.createServer((req, res) => void handlePipelineApi(req, res, options));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    mcp = start({ BASIS_URL: url, BASIS_API_TOKEN: TOKEN, BASIS_PROJECT: "" });
  });
  after(async () => {
    mcp.child.stdin.end();
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  test("introduces itself and lists its tools", async () => {
    const init = await mcp.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const { result } = await mcp.request("tools/list");
    assert.deepEqual(
      result.tools.map((tool: { name: string }) => tool.name),
      [
        "basis_projects",
        "basis_design_system",
        "basis_views",
        "basis_design_view",
        "basis_view_status",
        "basis_request_changes",
        "basis_fetch_kit",
        "basis_verify",
      ],
    );
  });

  test("uses the only project when a call names none", async () => {
    const design = (await mcp.tool("basis_design_system")).json();
    assert.equal(design.name, DEFAULT_DESIGN.name);
    assert.match(design.css, /--color-primary/);
    const views = (await mcp.tool("basis_views")).json();
    assert.equal(views.views[0].id, "web-12");
  });

  test("starts a view for an issue, follows it and asks for changes", async () => {
    const started = (await mcp.tool("basis_design_view", { issue: "WEB-13", title: "Reset password" })).json();
    assert.equal(started.view, "web-13");
    assert.match(turns.at(-1)!, /\(WEB-13\)/);
    const missing = (await mcp.tool("basis_view_status", { view: "web-13" })).json();
    assert.equal(missing.status, 404);
    assert.equal(missing.agent, "idle");
    const changed = (await mcp.tool("basis_request_changes", { view: "web-12", text: "Bigger heading" })).json();
    assert.equal(changed.thread, "t-9");
  });

  test("writes the kit into the repo, in the view's folder", async () => {
    const repo = path.join(root, "repo");
    const fetched = (await mcp.tool("basis_fetch_kit", { issue: "WEB-12", into: repo })).json();
    assert.deepEqual(fetched, {
      folder: "basis-verify/web-12",
      files: 1,
      prompt: "basis-verify/web-12/PROMPT.md",
      root: repo,
    });
    assert.equal(await readFile(path.join(repo, "basis-verify", "web-12", "PROMPT.md"), "utf8"), "build it");
  });

  test("runs basis-diff and gives the report's page in Basis", async () => {
    const verified = (
      await mcp.tool("basis_verify", { view: "web-12", targets: { screens: { log: "http://localhost:3000/" } } })
    ).json();
    assert.equal(verified.pass, true);
    assert.equal(verified.page, `${url}/verifications/auth-service/r1`);
  });

  test("says what is wrong instead of failing", async () => {
    const wrong = await mcp.tool("basis_view_status", { project: "nope", view: "x" });
    assert.ok(wrong.isError);
    assert.match(wrong.text, /404: No project nope/);
    const away = start({ BASIS_URL: "http://127.0.0.1:9", BASIS_API_TOKEN: TOKEN });
    try {
      const result = await away.tool("basis_projects");
      assert.ok(result.isError);
      assert.match(result.text, /Basis does not answer at http:\/\/127\.0\.0\.1:9/);
    } finally {
      away.child.stdin.end();
    }
    // A placeholder the agent passed on unfilled is no token: the one Basis keeps in BASIS_HOME is used.
    const home = path.join(root, "home");
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "api-token"), `${TOKEN}\n`);
    const placeholder = start({ BASIS_URL: url, BASIS_API_TOKEN: "${user_config.basis_api_token}", BASIS_HOME: home });
    try {
      assert.equal((await placeholder.tool("basis_projects")).json().projects[0].id, "auth-service");
    } finally {
      placeholder.child.stdin.end();
    }
    const noToken = start({ BASIS_URL: url, BASIS_API_TOKEN: "", BASIS_HOME: path.join(root, "empty") });
    try {
      assert.match((await noToken.tool("basis_projects")).text, /No API token/);
    } finally {
      noToken.child.stdin.end();
    }
  });
});
