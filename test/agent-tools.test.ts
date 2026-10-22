import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import readline from "node:readline";
import { test } from "node:test";
import { captureShots, DEFAULT_CAPTURE_WIDTHS, type CaptureList } from "../shared/capture.ts";
import {
  basisTool,
  basisToolTitle,
  describeShots,
  describeTypeErrors,
  handleToolRequest,
  MAX_SHOT_HEIGHT,
  parseScreenshotArgs,
  toolServer,
  TOOLS_PATH,
  toolsUrl,
  type ToolProject,
} from "../server/agent-tools.ts";
import { planCapture, type Screenshot } from "../server/screenshots.ts";

const list: CaptureList = {
  specimens: [
    { id: "buttons", title: "Buttons", page: "components" },
    { id: "team-members", title: "Team members", page: "views" },
  ],
  views: [
    {
      id: "team-members",
      title: "Team members",
      file: "views/TeamMembers.specimen.tsx",
      screens: [
        { id: "list", label: "Member list", shots: captureShots({ widths: [390, 1280] }) },
        { id: "invite", label: "Invite", shots: captureShots({ widths: [390, 1280] }) },
      ],
    },
  ],
  problems: [],
  widths: DEFAULT_CAPTURE_WIDTHS,
};

const sizes = (plan: ReturnType<typeof planCapture>) => plan.shots.map((shot) => `${shot.width}-${shot.theme}`);

test("a screenshot call defaults to the narrowest width in both themes", () => {
  const { target, options } = parseScreenshotArgs({ target: "Buttons" });
  assert.deepEqual(target, { id: "Buttons", screen: undefined });
  assert.equal(options.maxHeight, MAX_SHOT_HEIGHT);
  const plan = planCapture(list, target, options);
  assert.deepEqual(plan.query, { specimen: "buttons" });
  assert.deepEqual(sizes(plan), ["375-light", "375-dark"]);
  // A view's narrowest is its flow's, and screens go by label as well as id.
  const view = planCapture(list, ...args({ target: "team-members", screen: "Invite", theme: "dark" }));
  assert.deepEqual(view.query, { view: "team-members", screen: "invite" });
  assert.deepEqual(sizes(view), ["390-dark"]);
  assert.deepEqual(sizes(planCapture(list, ...args({ target: "buttons", widths: [1440, 768] }))), [
    "768-light",
    "1440-light",
    "768-dark",
    "1440-dark",
  ]);
});

test("a specimen's narrowest width is the project's Mobile width", () => {
  const project = { ...list, widths: [390, 768, 1440] };
  assert.deepEqual(sizes(planCapture(project, ...args({ target: "buttons" }))), ["390-light", "390-dark"]);
});

function args(raw: unknown) {
  const { target, options } = parseScreenshotArgs(raw);
  return [target, options] as const;
}

test("a screenshot call is refused with what to change", () => {
  assert.throws(() => parseScreenshotArgs({}), /`target` is required/);
  assert.throws(() => parseScreenshotArgs({ target: "buttons", widths: [100] }), /whole numbers of CSS pixels/);
  assert.throws(() => parseScreenshotArgs({ target: "buttons", widths: ["375"] }), /whole numbers/);
  assert.throws(() => parseScreenshotArgs({ target: "buttons", theme: "sepia" }), /"light", "dark" or "both"/);
  assert.throws(
    () => planCapture(list, ...args({ target: "buttons", widths: [375, 768, 1440] })),
    /That is 6 images \(3 widths in 2 themes\); at most 4 per call/,
  );
  assert.throws(
    () => planCapture(list, ...args({ target: "badge" })),
    /No specimen or view "badge". Specimens: buttons, team-members. Views: team-members./,
  );
  assert.throws(() => planCapture(list, ...args({ target: "buttons", screen: "list" })), /not a view/);
  assert.throws(() => planCapture(list, ...args({ target: "team-members", screen: "edit" })), /no screen "edit"/);
});

function shot(width: number, theme: "light" | "dark", extra: Partial<Screenshot> = {}): Screenshot {
  return {
    width,
    viewportHeight: 812,
    fullPage: true,
    theme,
    png: Buffer.from("png"),
    imageHeight: 900,
    pageHeight: 900,
    cut: false,
    failed: false,
    ...extra,
  };
}

test("the text names each image and says when one is cut or failed", () => {
  const plan = planCapture(list, ...args({ target: "team-members", screen: "invite" }));
  const text = describeShots(plan, [
    shot(390, "light", { imageHeight: 2000, pageHeight: 3100, cut: true }),
    shot(390, "dark", { failed: true }),
  ]);
  assert.equal(
    text,
    [
      'Screen "invite" of the view "team-members", 2 images:',
      "1. 390 px wide, light (cut at 2000 px of the page's 3100 px; a wider width shows more of it)",
      "2. 390 px wide, dark (it shows an error: what the page renders threw)",
      "Its other screens: list (Member list).",
    ].join("\n"),
  );
});

test("Basis' own tools are told apart from every other tool", () => {
  assert.equal(basisTool({ title: "mcp__basis__screenshot" }), "screenshot");
  assert.equal(
    basisTool({ title: "Screenshot", _meta: { claudeCode: { toolName: "mcp__basis__screenshot" } } }),
    "screenshot",
  );
  // Codex titles them mcp.<server>.<tool>.
  assert.equal(basisTool({ title: "mcp.basis.screenshot" }), "screenshot");
  assert.equal(basisTool({ title: "mcp__basis__delete_everything" }), null);
  assert.equal(basisTool({ title: "mcp__other__screenshot" }), null);
  assert.equal(basisTool({ title: "Read file" }), null);
  assert.equal(basisToolTitle("screenshot", { target: "Navbar" }), "Screenshot of Navbar");
  assert.equal(basisToolTitle("screenshot", { target: "team", screen: "invite" }), "Screenshot of team (invite)");
  assert.equal(basisToolTitle("screenshot", {}), "Screenshot");
  assert.equal(basisTool({ title: "mcp__basis__typecheck" }), "typecheck");
  assert.equal(basisToolTitle("typecheck", {}), "Type check");
  assert.equal(
    basisToolTitle("screenshot", { server: "basis", tool: "screenshot", arguments: { target: "Navbar" } }),
    "Screenshot of Navbar",
  );
});

test("a type check says how many errors there are, and shows at most 50", () => {
  assert.equal(describeTypeErrors([]), "No type errors in components/, patterns/ or views/.");
  assert.equal(describeTypeErrors(["a.tsx(1,1): error TS1"]), "1 type error:\na.tsx(1,1): error TS1");
  const many = Array.from({ length: 60 }, (_, index) => `e${index}`);
  const text = describeTypeErrors(many);
  assert.match(text, /^60 type errors:\ne0\n/);
  assert.match(text, /\ne49\nThe first 50 are shown\.$/);
  assert.doesNotMatch(text, /e50/);
});

/** Basis' tool route with stand-in screenshots and type check, and the MCP server script talking to it as an agent would. */
async function withToolServer(work: (rpc: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>) {
  const secret = "s3cret";
  const project: ToolProject = {
    screenshots: {
      capture: async (target, options) => {
        const plan = planCapture(list, target, options);
        return { plan, shots: plan.shots.map((item) => shot(item.width, item.theme)) };
      },
    },
    typecheck: async () => [
      "patterns/Navbar.tsx(3,7): error TS2322: Type 'number' is not assignable to type 'string'.",
    ],
  };
  const server = http.createServer(
    (req, res) => void handleToolRequest(req, res, secret, (name) => (name === "acme" ? project : null)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = toolsUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "acme");
  const entry = toolServer(url, secret);
  const child = spawn(entry.command, entry.args, {
    env: { ...process.env, ...Object.fromEntries(entry.env.map((item) => [item.name, item.value])) },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let id = 0;
  const rpc = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      id += 1;
      waiting.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      );
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  try {
    await work(rpc);
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
    server.close();
  }
}

test("the MCP server lists Basis' tools and forwards calls to Basis", async () => {
  await withToolServer(async (rpc) => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })) as {
      protocolVersion: string;
      capabilities: unknown;
    };
    assert.equal(init.protocolVersion, "2025-06-18");
    assert.deepEqual(init.capabilities, { tools: {} });
    const { tools } = (await rpc("tools/list")) as { tools: { name: string }[] };
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["screenshot", "typecheck"],
    );
    const result = (await rpc("tools/call", { name: "screenshot", arguments: { target: "buttons" } })) as {
      content: { type: string; text?: string; mimeType?: string }[];
      isError?: boolean;
    };
    assert.equal(result.isError, undefined);
    assert.deepEqual(
      result.content.map((item) => item.type),
      ["text", "text", "image", "text", "image"],
    );
    assert.match(result.content[0]!.text!, /^Specimen "buttons", 2 images:/);
    assert.equal(result.content[2]!.mimeType, "image/png");
    const refused = (await rpc("tools/call", { name: "screenshot", arguments: { target: "nothing" } })) as {
      content: { text: string }[];
      isError: boolean;
    };
    assert.equal(refused.isError, true);
    assert.match(refused.content[0]!.text, /No specimen or view "nothing"/);
    const checked = (await rpc("tools/call", { name: "typecheck" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    assert.equal(checked.isError, undefined);
    assert.match(checked.content[0]!.text, /^1 type error:\npatterns\/Navbar\.tsx\(3,7\): error TS2322/);
    await assert.rejects(rpc("resources/list"), /Method not found/);
  });
});

test("the tool route refuses requests without the secret, and names its project", async () => {
  const asked: string[] = [];
  const server = http.createServer(
    (req, res) =>
      void handleToolRequest(req, res, "right", (project) => {
        asked.push(project);
        return null;
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const base = toolsUrl(origin, "my project");
  try {
    // Without a project in the path there is nothing to answer.
    assert.equal(
      (await fetch(`${origin}${TOOLS_PATH}/list`, { headers: { authorization: "Bearer right" } })).status,
      404,
    );
    assert.equal((await fetch(`${base}/list`)).status, 401);
    assert.equal((await fetch(`${base}/list`, { headers: { authorization: "Bearer wrong" } })).status, 401);
    const ok = await fetch(`${base}/list`, { headers: { authorization: "Bearer right" } });
    assert.equal(ok.status, 200);
    // A project that is not open has no screenshots to take; the agent is told so.
    const call = await fetch(`${base}/call`, {
      method: "POST",
      headers: { authorization: "Bearer right" },
      body: JSON.stringify({ name: "screenshot", arguments: { target: "buttons" } }),
    });
    assert.match(JSON.stringify(await call.json()), /not open in Basis/);
    assert.deepEqual(asked, ["my project"]);
  } finally {
    server.close();
  }
});
