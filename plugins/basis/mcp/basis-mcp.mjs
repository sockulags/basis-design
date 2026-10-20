#!/usr/bin/env node
/*
 * An MCP server that lets any coding agent use Basis: list its projects and views, read a project's design
 * system, have a view designed for an issue, ask for changes, fetch the verification kit into the repo, and run
 * basis-diff, Basis' own check of the product against the design. It speaks MCP's JSON-RPC over stdio, one message
 * per line, and has no dependencies, so Node runs it as it is.
 *
 * Settings, from the environment:
 *   BASIS_URL        where Basis answers (default http://localhost:5320)
 *   BASIS_API_TOKEN  its API token; without it, the token a Basis on this machine keeps in
 *                    $BASIS_HOME/api-token (default ~/.basis/api-token)
 *   BASIS_PROJECT    the project to use when a call names none (else the only one there is)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { inflateRawSync } from "node:zlib";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** A setting from the environment; an empty one, or a placeholder an agent passed on unfilled (${…}), is none. */
function setting(name) {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("${") ? value : undefined;
}

const baseUrl = (setting("BASIS_URL") || "http://localhost:5320").replace(/\/$/, "");

function token() {
  if (setting("BASIS_API_TOKEN")) return setting("BASIS_API_TOKEN");
  const home = process.env.BASIS_HOME || path.join(os.homedir(), ".basis");
  try {
    return readFileSync(path.join(home, "api-token"), "utf8").trim();
  } catch {
    throw new Error(
      `No API token: set BASIS_API_TOKEN, or start Basis on this machine (npx basis-design), which keeps one in ${path.join(home, "api-token")}.`,
    );
  }
}

/** Calls the API: a GET, or a POST of `body` as JSON. */
async function call(route, body) {
  const headers = { authorization: `Bearer ${token()}`, "content-type": "application/json" };
  let response;
  try {
    response = await fetch(
      `${baseUrl}/v1${route}`,
      body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) },
    );
  } catch (error) {
    throw new Error(`Basis does not answer at ${baseUrl} (${error.cause?.code ?? error.message}). Is it running?`);
  }
  if (response.headers.get("content-type")?.includes("application/zip")) return response;
  const answer = await response.json().catch(() => ({}));
  if (!response.ok && !(response.status === 404 && answer.agent)) {
    throw new Error(`Basis answered ${response.status}: ${answer.error ?? "no reason given"}`);
  }
  return { status: response.status, ...answer };
}

/** The project a call names, BASIS_PROJECT, or the only project there is. */
async function project(named) {
  const chosen = named || setting("BASIS_PROJECT");
  if (chosen) return encodeURIComponent(chosen);
  const { projects } = await call("/projects");
  if (projects.length === 1) return encodeURIComponent(projects[0].id);
  throw new Error(`Name the project: ${projects.map((item) => `${item.id} (${item.name})`).join(", ")}.`);
}

/** Unpacks the kit zip into `root`: every file in the folder Basis names, replacing what the kit holds there. */
function unpack(zip, folder, root) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/.test(folder))
    throw new Error("Basis named no kit folder.");
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Basis' answer is not a zip.");
  const files = [];
  for (let i = 0, at = zip.readUInt32LE(end + 16); i < zip.readUInt16LE(end + 10); i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    if (
      !name.startsWith(`${folder}/`) ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      name.includes("\\")
    )
      throw new Error(`The kit holds a file outside ${folder}/: ${name}`);
    if (method !== 0 && method !== 8) throw new Error("The zip uses a compression this server cannot read.");
    files.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });
  }
  for (const top of new Set(files.map((file) => file.name.slice(folder.length + 1).split("/")[0]))) {
    rmSync(path.join(root, folder, top), { recursive: true, force: true });
  }
  for (const file of files) {
    const target = path.join(root, file.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.data);
  }
  return files.length;
}

const projectArg = {
  type: "string",
  description: "The Basis project, by id or name; BASIS_PROJECT or the only one when left out.",
};

const TOOLS = [
  {
    name: "basis_projects",
    description: "Lists the Basis projects: id, name and the product repo each designs for.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/projects"),
  },
  {
    name: "basis_design_system",
    description:
      "The project's design system: its tokens (JSON, and as CSS custom properties) and the TypeScript contracts of its components and patterns. Use it to build UI with the product's own tokens and components instead of guessing values.",
    inputSchema: { type: "object", properties: { project: projectArg } },
    run: async ({ project: named }) => call(`/projects/${await project(named)}/design`),
  },
  {
    name: "basis_views",
    description: "Lists the project's views (designed screens of product flows) and their screens.",
    inputSchema: { type: "object", properties: { project: projectArg } },
    run: async ({ project: named }) => call(`/projects/${await project(named)}/views`),
  },
  {
    name: "basis_design_view",
    description:
      "Has Basis' design agent design the screens for an issue as a view named for it (WEB-12 becomes the view web-12). It returns at once; the design takes minutes. Follow it with basis_view_status, and have a person review it in Basis.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        issue: { type: "string", description: "The issue's key, such as WEB-12 or owner/repo#42." },
        title: { type: "string", description: "The issue's title." },
        description: { type: "string", description: "The issue's text: the feature, acceptance criteria." },
      },
      required: ["issue"],
    },
    run: async ({ project: named, issue, title, description }) =>
      call(`/projects/${await project(named)}/views`, { issue, title, description }),
  },
  {
    name: "basis_view_status",
    description:
      "One view: its screens, whether Basis' agent is still working (agent: working, waiting for an answer, idle), and whether a review in Basis shows it (review: open). status 404 means it does not exist yet.",
    inputSchema: {
      type: "object",
      properties: { project: projectArg, view: { type: "string", description: "The view's id, such as web-12." } },
      required: ["view"],
    },
    run: async ({ project: named, view }) =>
      call(`/projects/${await project(named)}/views/${encodeURIComponent(view)}`),
  },
  {
    name: "basis_request_changes",
    description: "Asks Basis' design agent for changes to a view, in words; it opens the result in a review in Basis.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        view: { type: "string" },
        text: { type: "string", description: "What to change." },
      },
      required: ["view", "text"],
    },
    run: async ({ project: named, view, text }) =>
      call(`/projects/${await project(named)}/views/${encodeURIComponent(view)}/messages`, { text }),
  },
  {
    name: "basis_fetch_kit",
    description:
      "Writes the verification kit of an issue's view (or of chosen views) into this repo, in basis-verify/<view>/ unless a folder is given: screenshots of every screen, notes, the design's source, and the scripts to compare an implementation. Read its PROMPT.md next.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        issue: { type: "string", description: "The issue the view is named for." },
        views: { type: "array", items: { type: "string" }, description: "View ids, instead of an issue." },
        folder: { type: "string", description: "The kit's folder in the repo." },
        into: { type: "string", description: "The repo's root; the current folder when left out." },
      },
    },
    run: async ({ project: named, issue, views, folder, into }) => {
      const response = await call(`/projects/${await project(named)}/kit`, {
        ...(issue ? { issue } : {}),
        ...(views ? { views } : {}),
        ...(folder ? { folder } : {}),
      });
      if (!(response instanceof Response)) throw new Error("Basis did not answer with a kit.");
      const kitFolder = response.headers.get("x-basis-kit-folder") ?? "";
      const root = path.resolve(into || process.cwd());
      const count = unpack(Buffer.from(await response.arrayBuffer()), kitFolder, root);
      return { folder: kitFolder, files: count, prompt: `${kitFolder}/PROMPT.md`, root };
    },
  },
  {
    name: "basis_verify",
    description:
      "basis-diff: Basis photographs the view's screens and the product's pages at the URLs given, with one browser, compares them, and keeps the images and the verdict where no agent can change them. pass leaves out only image placeholders; exceptions you declare count only in passWithExceptions and are shown to the reviewer. The product's pages must be reachable from Basis. Returns the verdict per shot and the report's page in Basis.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        view: { type: "string" },
        targets: {
          type: "object",
          description:
            '{ "baseUrl": "http://localhost:3000", "screens": { "<screen id>": "/path" | { "url": "/path", "waitFor": "css selector" } }, "themeAttribute"?: "data-theme" }',
        },
        exceptions: {
          type: "array",
          items: { type: "object" },
          description: "As in the kit's exceptions.json, each with a reason.",
        },
        label: { type: "string", description: "What is checked: the issue, the branch, the commit." },
      },
      required: ["view", "targets"],
    },
    run: async ({ project: named, view, targets, exceptions, label }) => {
      const result = await call(`/projects/${await project(named)}/views/${encodeURIComponent(view)}/verify`, {
        targets,
        exceptions,
        label,
      });
      return { ...result, page: result.page ? `${baseUrl}${result.page}` : undefined };
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function answer(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "basis", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call": {
      const tool = TOOLS.find((item) => item.name === params?.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
      try {
        const result = await tool.run(params?.arguments ?? {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (message.id === undefined || message.id === null) return;
  try {
    send({ id: message.id, result: await answer(message.method, message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
