import { randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import type { CaptureTheme } from "../shared/capture.ts";
import type { CapturePlan, Screenshot, Screenshots, ShotOptions, ShotTarget } from "./screenshots.ts";

/*
 * Tools Basis gives the design agent. Every session gets an MCP server of Basis' own (agent-tools-mcp.mjs), started
 * by the agent over stdio, which every ACP agent supports. That script only speaks MCP: it forwards listings and
 * calls to the chrome server over HTTP on 127.0.0.1 with a secret made at each start, and the work happens here,
 * where the projects' screenshots are. Each project's server has a URL of its own (`toolsUrl`), which names the
 * project, so an agent's screenshots are of its own project whichever one a tab shows. Basis approves its own tools
 * without asking the user.
 */

/** The MCP server's name in the session; Claude Code calls its tools `mcp__basis__<tool>`. */
export const TOOL_SERVER = "basis";
/** Where the chrome server answers the MCP server: `/agent-tools/<project>/list` and `/call`. */
export const TOOLS_PATH = "/agent-tools";

/** The URL a project's MCP server sends its requests under, on the chrome server at `origin`. */
export function toolsUrl(origin: string, project: string): string {
  return `${origin}${TOOLS_PATH}/${encodeURIComponent(project)}`;
}
const SCRIPT = path.join(import.meta.dirname, "agent-tools-mcp.mjs");

/** Images per screenshot call. */
export const MAX_SCREENSHOTS = 4;
/** Full-page screenshots are cut at this height: a few phone screens, and still legible once an agent scales it. */
export const MAX_SHOT_HEIGHT = 2000;
const MIN_WIDTH = 200;
const MAX_WIDTH = 4000;

/** An MCP tool as `tools/list` describes it. */
export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };

/** What `tools/call` returns. Errors the agent can act on are results with `isError`, not protocol errors. */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "screenshot",
    title: "Screenshot",
    description: [
      "Photographs the live design the way the gallery renders it, from what is saved now.",
      "`target` is a specimen (a component's, pattern's or view's section, by id or title, such as `buttons` or `Navbar`): it is shown alone, as in its gallery section.",
      "For a view, `target` is the view and `screen` one of its screens (id or label; the first when left out): the bare screen, as the verification kit photographs it.",
      `By default it takes the narrowest width the target is shown at (the project's Mobile width, unless a view's flow names its own), in light and dark. \`widths\` picks widths in CSS pixels and \`theme\` one theme; at most ${MAX_SCREENSHOTS} images a call.`,
      `Pages taller than ${MAX_SHOT_HEIGHT} px are cut there, and the result says so.`,
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "A specimen's or view's id or title." },
        screen: { type: "string", description: "For a view: the screen's id or label." },
        widths: {
          type: "array",
          items: { type: "integer", minimum: MIN_WIDTH, maximum: MAX_WIDTH },
          maxItems: MAX_SCREENSHOTS,
          description:
            "Widths in CSS pixels, e.g. [768, 1440]. Default: the narrowest the target is shown at (the project's Mobile width).",
        },
        theme: { type: "string", enum: ["light", "dark", "both"], description: "Default: both." },
      },
      required: ["target"],
      additionalProperties: false,
    },
  },
];

/** A screenshot call's arguments, checked: what to photograph and how. Throws with what is wrong. */
export function parseScreenshotArgs(raw: unknown): { target: ShotTarget; options: ShotOptions } {
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const target = typeof args.target === "string" ? args.target.trim() : "";
  if (!target) throw new Error("`target` is required: a specimen's or view's id or title.");
  const screen = typeof args.screen === "string" && args.screen.trim() ? args.screen.trim() : undefined;
  let widths: number[] | undefined;
  if (args.widths !== undefined) {
    const list = Array.isArray(args.widths) ? args.widths : [args.widths];
    if (!list.every((width) => Number.isInteger(width) && width >= MIN_WIDTH && width <= MAX_WIDTH)) {
      throw new Error(`\`widths\` takes whole numbers of CSS pixels from ${MIN_WIDTH} to ${MAX_WIDTH}.`);
    }
    widths = list as number[];
  }
  const theme = args.theme ?? "both";
  if (theme !== "light" && theme !== "dark" && theme !== "both") {
    throw new Error('`theme` is "light", "dark" or "both".');
  }
  const themes: CaptureTheme[] = theme === "both" ? ["light", "dark"] : [theme];
  return {
    target: { id: target, screen },
    options: { widths, themes, narrowest: true, maxShots: MAX_SCREENSHOTS, maxHeight: MAX_SHOT_HEIGHT },
  };
}

/** The text that goes with the images: what they show, in order, and what to know about them. */
export function describeShots(plan: CapturePlan, shots: Screenshot[]): string {
  const { specimen, view, screen } = plan.query;
  const lines = [
    specimen
      ? `Specimen "${specimen}", ${shots.length === 1 ? "1 image" : `${shots.length} images`}:`
      : `Screen "${screen}" of the view "${view}", ${shots.length === 1 ? "1 image" : `${shots.length} images`}:`,
  ];
  for (const [index, shot] of shots.entries()) {
    const notes = [
      shot.failed ? "it shows an error: what the page renders threw" : "",
      shot.cut
        ? `cut at ${shot.imageHeight} px of the page's ${shot.pageHeight} px; a wider width shows more of it`
        : "",
    ].filter(Boolean);
    lines.push(`${index + 1}. ${label(shot)}${notes.length ? ` (${notes.join("; ")})` : ""}`);
  }
  const others = plan.screens?.filter((item) => item.id !== screen) ?? [];
  if (others.length) lines.push(`Its other screens: ${others.map((item) => `${item.id} (${item.label})`).join(", ")}.`);
  return lines.join("\n");
}

function label(shot: Screenshot): string {
  return `${shot.width} px wide, ${shot.theme}`;
}

/** What the tools need of the open project's screenshots (server/screenshots.ts). */
export type ToolScreenshots = Pick<Screenshots, "capture">;

/** Runs one of Basis' tools. */
export async function callTool(name: unknown, args: unknown, screenshots: ToolScreenshots): Promise<ToolResult> {
  if (name !== "screenshot") return failure(`Basis has no tool "${String(name)}".`);
  try {
    const { target, options } = parseScreenshotArgs(args);
    const { plan, shots } = await screenshots.capture(target, options);
    const content: ToolContent[] = [{ type: "text", text: describeShots(plan, shots) }];
    for (const [index, shot] of shots.entries()) {
      content.push({ type: "text", text: `${index + 1}. ${label(shot)}` });
      content.push({ type: "image", data: shot.png.toString("base64"), mimeType: "image/png" });
    }
    return { content };
  } catch (error) {
    return failure((error as Error).message);
  }
}

function failure(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** A new secret for the MCP server to send with every request, made at each start. */
export function toolSecret(): string {
  return randomBytes(32).toString("hex");
}

/** The MCP server every session gets: Node runs the script, which reaches Basis at `url` with `secret`. */
export function toolServer(url: string, secret: string): acp.McpServerStdio {
  return {
    name: TOOL_SERVER,
    command: process.execPath,
    args: [SCRIPT],
    env: [
      { name: "BASIS_TOOLS_URL", value: url },
      { name: "BASIS_TOOLS_SECRET", value: secret },
    ],
  };
}

/**
 * The name of one of Basis' tools a tool call is for, or null. Claude Code titles MCP tool calls
 * `mcp__<server>__<tool>` (also in `_meta.claudeCode.toolName`), Codex `mcp.<server>.<tool>`. Codex's approval
 * request has no title, only the id of the call it reported before; AgentHost matches it by that.
 */
export function basisTool(call: { title?: string | null; _meta?: Record<string, unknown> | null }): string | null {
  const meta = call._meta?.claudeCode as { toolName?: unknown } | undefined;
  const names = [call.title, typeof meta?.toolName === "string" ? meta.toolName : undefined];
  for (const name of names) {
    const tool = name?.match(/^(?:mcp__basis__|mcp\.basis\.)([a-z_]+)$/)?.[1];
    if (tool && TOOLS.some((item) => item.name === tool)) return tool;
  }
  return null;
}

/** How the chat shows a call of one of Basis' tools, instead of its MCP name. */
export function basisToolTitle(tool: string, rawInput: unknown): string {
  const object = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  // Codex reports `{ server, tool, arguments }`, Claude Code the arguments themselves.
  const raw = object(rawInput);
  const input = "arguments" in raw && "server" in raw ? object(raw.arguments) : raw;
  if (tool !== "screenshot" || typeof input.target !== "string") return "Screenshot";
  return `Screenshot of ${input.target}${typeof input.screen === "string" ? ` (${input.screen})` : ""}`;
}

/**
 * Answers the MCP server: `GET /agent-tools/<project>/list` and `POST /agent-tools/<project>/call` with
 * `{ name, arguments }`. Only with the secret, so a web page or another local program cannot use the tools.
 * `screenshots` gives the named project's, or null when it is not open.
 */
export async function handleToolRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  secret: string,
  screenshots: (project: string) => ToolScreenshots | null,
): Promise<void> {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply(401, {});
  const [project, action] =
    req.url
      ?.split("?")[0]
      ?.match(/^\/agent-tools\/([^/]+)\/(list|call)$/)
      ?.slice(1) ?? [];
  if (!project) return reply(404, {});
  if (req.method === "GET" && action === "list") return reply(200, { tools: TOOLS });
  if (req.method !== "POST" || action !== "call") return reply(404, {});
  let body: { name?: unknown; arguments?: unknown };
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) return reply(413, {});
    }
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return reply(400, {});
  }
  let name: string;
  try {
    name = decodeURIComponent(project);
  } catch {
    return reply(404, {});
  }
  const open = screenshots(name);
  if (!open) return reply(200, failure("This project is not open in Basis now. Try again in a moment."));
  reply(200, await callTool(body.name, body.arguments, open));
}
