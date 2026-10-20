import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { CaptureList } from "../shared/capture.ts";
import type { ProjectEntry, VerifyKitSummary } from "../shared/protocol.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handlePipelineApi, viewName, type ApiOptions, type ApiProject } from "../server/api.ts";
import { Verifications, type DiffReport, type DiffRequest } from "../server/diff.ts";

const TOKEN = "secret-token";
const ENTRY: ProjectEntry = { id: "p1", name: "Auth-service", dir: "/ws", repo: "/repo" };

/** A project whose agent records its turns, and whose design has the views given. */
function fakeProject(views: string[]) {
  const turns: { text: string; instruction?: string; thread?: string }[] = [];
  const list: CaptureList = {
    specimens: [],
    widths: [375],
    problems: [],
    views: views.map((id) => ({
      id,
      title: id,
      file: `views/${id}.specimen.tsx`,
      screens: [{ id: "main", label: "Main", shots: [] }],
    })),
  };
  const project: ApiProject = {
    entry: ENTRY,
    busy: false,
    waiting: false,
    agent: {
      whenReady: async () => true,
      newThread: () => "t-1",
      prompt: async (text, { instruction }, { thread }) => void turns.push({ text, instruction, thread }),
    },
    screenshots: { list: async () => list },
    workspace: { review: null as { show: { specimen: string }[]; files: string[] } | null },
  };
  return { project, turns };
}

describe("the pipeline API", () => {
  const { project, turns } = fakeProject(["web-12", "billing"]);
  const kits: { views?: string[]; folder?: string }[] = [];
  let building = false;
  const options: ApiOptions = {
    token: TOKEN,
    projects: () => [ENTRY],
    open: async () => project,
    buildKit: async (_, request) => {
      if (building) return null;
      kits.push(request);
      const known = (request.views ?? ["web-12", "billing"]).filter((id) => ["web-12", "billing"].includes(id));
      if (!known.length) throw new Error("None of the chosen views is in the design any more.");
      const summary = { folder: request.folder ?? "basis-verify", shots: 3 } as VerifyKitSummary;
      return { files: [{ path: "PROMPT.md", data: strToU8("kit") }], summary };
    },
    zip: (files, folder) => zipSync(Object.fromEntries(files.map((file) => [`${folder}/${file.path}`, file.data]))),
    // basis-diff: records what it was asked and writes a report the way runDiff does.
    verify: async (_, view, request) => {
      diffs.push(request);
      const { id, dir } = await store.create("p1", view.id);
      const report = {
        id,
        view: view.id,
        title: view.title,
        createdAt: new Date().toISOString(),
        pass: false,
        passWithExceptions: true,
        label: request.label ?? null,
        shots: [{ file: "a.png", status: "fail", percent: 1.5, problems: [], withExceptions: { status: "pass" } }],
        files: {},
      } as unknown as DiffReport;
      await (await import("node:fs/promises")).writeFile(path.join(dir, "report.json"), JSON.stringify(report));
      return report;
    },
    get verifications() {
      return store;
    },
    reportPath: (project, id) => `/verifications/${project}/${id}`,
  };
  const diffs: DiffRequest[] = [];
  let store: Verifications;
  let storeDir = "";
  let server: http.Server;
  let base = "";
  before(async () => {
    server = http.createServer((req, res) => {
      void handlePipelineApi(req, res, options).then((handled) => {
        if (!handled) res.writeHead(418).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => server.close());

  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    });

  test("answers only with the token, and leaves other paths to the caller", async () => {
    assert.equal((await call("/v1/projects", {}, null)).status, 401);
    assert.equal((await call("/v1/projects", {}, "secret-tokem")).status, 401);
    assert.equal((await call("/v1/projects")).status, 200);
    assert.equal((await call("/other")).status, 418);
  });

  test("lists projects, found by id or by name, and their views", async () => {
    assert.deepEqual(await (await call("/v1/projects")).json(), {
      projects: [{ id: "p1", name: "Auth-service", repo: "/repo" }],
    });
    const views = (await (await call("/v1/projects/auth-service/views")).json()) as { views: { id: string }[] };
    assert.deepEqual(
      views.views.map((view) => view.id),
      ["web-12", "billing"],
    );
    assert.equal((await call("/v1/projects/nope/views")).status, 404);
    const one = (await (await call("/v1/projects/p1/views/web-12")).json()) as { id: string; agent: string };
    assert.equal(one.agent, "idle");
    const missing = await call("/v1/projects/p1/views/web-99");
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { agent: string }).agent, "idle");
  });

  test("starts the New view turn for an issue, named for it", async () => {
    const response = await call("/v1/projects/p1/views", {
      method: "POST",
      body: JSON.stringify({ issue: "WEB-13", title: "Reset password", description: "As a user I can reset it." }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      view: "web-13",
      name: "ResetPassword",
      thread: "t-1",
      kitFolder: "basis-verify/web-13",
    });
    const turn = turns.at(-1)!;
    assert.equal(turn.thread, "t-1");
    assert.match(turn.text, /^New view: ResetPassword \(WEB-13\)\n\nReset password\n\nAs a user I can reset it\.$/);
    assert.match(turn.instruction ?? "", /`id: "web-13"`/);
    const bad = await call("/v1/projects/p1/views", { method: "POST", body: JSON.stringify({ issue: "../x" }) });
    assert.equal(bad.status, 400);
    assert.equal((await call("/v1/projects/p1/views", { method: "POST", body: "[1]" })).status, 400);
  });

  test("builds the kit of an issue's view into its folder, as a zip", async () => {
    const response = await call("/v1/projects/p1/kit", { method: "POST", body: JSON.stringify({ issue: "WEB-12" }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("x-basis-kit-folder"), "basis-verify/web-12");
    assert.deepEqual(kits.at(-1), { views: ["web-12"], folder: "basis-verify/web-12" });
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(Object.keys(files), ["basis-verify/web-12/PROMPT.md"]);

    await call("/v1/projects/p1/kit", {
      method: "POST",
      body: JSON.stringify({ views: ["billing"], folder: "kits/b" }),
    });
    assert.deepEqual(kits.at(-1), { views: ["billing"], folder: "kits/b" });
    const outside = await call("/v1/projects/p1/kit", { method: "POST", body: JSON.stringify({ folder: "../x" }) });
    assert.equal(outside.status, 400);
    const gone = await call("/v1/projects/p1/kit", { method: "POST", body: JSON.stringify({ issue: "WEB-99" }) });
    assert.equal(gone.status, 404);
    building = true;
    const busy = await call("/v1/projects/p1/kit", { method: "POST", body: "{}" });
    building = false;
    assert.equal(busy.status, 409);
  });

  test("says when an open review shows a view, by its id or title or its file", async () => {
    const review = async () =>
      ((await (await call("/v1/projects/p1/views/web-12")).json()) as { review: unknown }).review;
    assert.equal(await review(), null);
    project.workspace.review = { show: [{ specimen: "web-12" }], files: [] };
    assert.equal(await review(), "open");
    project.workspace.review = { show: [{ specimen: "Buttons" }], files: ["views/web-12.specimen.tsx"] };
    assert.equal(await review(), "open");
    project.workspace.review = { show: [{ specimen: "Buttons" }], files: ["components/Button.tsx"] };
    assert.equal(await review(), null);
    project.workspace.review = null;
  });

  test("asks for changes to a view in a turn of its own", async () => {
    const response = await call("/v1/projects/p1/views/web-12/messages", {
      method: "POST",
      body: JSON.stringify({ text: "Show the IP address in the list too." }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { view: "web-12", thread: "t-1" });
    const turn = turns.at(-1)!;
    assert.equal(turn.text, "Changes to web-12\n\nShow the IP address in the list too.");
    assert.match(turn.instruction ?? "", /Keep the specimen's id "web-12"/);
    const missing = await call("/v1/projects/p1/views/web-99/messages", { method: "POST", body: '{"text":"x"}' });
    assert.equal(missing.status, 404);
    const empty = await call("/v1/projects/p1/views/web-12/messages", { method: "POST", body: '{"text":" "}' });
    assert.equal(empty.status, 400);
  });

  test("runs basis-diff for a view, and lists and gives its reports", async () => {
    storeDir = await mkdtemp(path.join(tmpdir(), "basis-api-diff-"));
    store = new Verifications(storeDir);
    try {
      const body = { targets: { baseUrl: "http://localhost:3000", screens: { main: "/audit" } }, label: "WEB-12" };
      const response = await call("/v1/projects/p1/views/web-12/verify", {
        method: "POST",
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        id: string;
        pass: boolean;
        page: string;
        report: string;
        shots: unknown[];
      };
      assert.equal(result.pass, false);
      assert.deepEqual(result.shots, [
        { file: "a.png", status: "fail", percent: 1.5, problems: [], withExceptions: "pass" },
      ]);
      assert.equal(result.page, `/verifications/p1/${result.id}`);
      assert.equal(diffs.at(-1)?.label, "WEB-12");
      const listed = (await (await call("/v1/projects/p1/views/web-12/verifications")).json()) as {
        verifications: { id: string }[];
      };
      assert.deepEqual(
        listed.verifications.map((item) => item.id),
        [result.id],
      );
      const report = await call(result.report);
      assert.equal(report.status, 200);
      assert.equal(((await report.json()) as { page: string }).page, result.page);
      assert.equal((await call("/v1/projects/p1/verifications/nope")).status, 404);
      assert.equal((await call(`/v1/projects/p1/verifications/${result.id}/files/expected/a.png`)).status, 404);
      const bad = await call("/v1/projects/p1/views/web-12/verify", { method: "POST", body: '{"targets":{}}' });
      assert.equal(bad.status, 400);
      const unknown = await call("/v1/projects/p1/views/web-99/verify", { method: "POST", body: JSON.stringify(body) });
      assert.equal(unknown.status, 404);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  test("is off without a token", async () => {
    const off = http.createServer((req, res) => void handlePipelineApi(req, res, { ...options, token: undefined }));
    await new Promise<void>((resolve) => off.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(off.address() as { port: number }).port}/v1/projects`, {
        headers: { Authorization: "Bearer " },
      });
      assert.equal(response.status, 404);
      assert.match(((await response.json()) as { error: string }).error, /BASIS_API_TOKEN/);
    } finally {
      off.close();
    }
  });
});

test("a view for an issue is named from its title, else its key", () => {
  assert.equal(viewName("WEB-12", "Reset password", ""), "ResetPassword");
  assert.equal(viewName("WEB-12", "", ""), "WEB12");
  assert.equal(viewName("42", "", ""), "View42");
  assert.equal(viewName("WEB-12", "Reset", "SignIn"), "SignIn");
});
