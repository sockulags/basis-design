import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { annotationLabel, formatAnnotations, type Annotation } from "../shared/annotations.ts";
import {
  IMAGE_TYPES,
  MAX_IMAGE_BASE64,
  MAX_IMAGES,
  type AgentId,
  type AgentState,
  type ChatItem,
  type PermissionChoice,
  type PromptImage,
  type ToolStatus,
} from "../shared/protocol.ts";
import { AGENT_BRIEF, FIRST_PROMPT_PREAMBLE } from "./brief.ts";
import type { Workspace } from "./workspace.ts";

const require = createRequire(import.meta.url);

interface LaunchSpec {
  command: string;
  args: string[];
  shell: boolean;
  loginHint: string;
}

/** How each supported agent is started. Both reuse the user's own CLI login, so no API keys are needed. */
function launchSpec(id: AgentId): LaunchSpec {
  if (id === "claude") {
    const pkg = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
    return {
      command: process.execPath,
      args: [path.join(path.dirname(pkg), "dist", "index.js")],
      shell: false,
      loginHint: "Run `claude` in a terminal and log in, then restart the agent.",
    };
  }
  return {
    command: "npx",
    args: ["-y", "@zed-industries/codex-acp"],
    shell: true,
    loginHint: "Run `codex login` in a terminal, then restart the agent.",
  };
}

/**
 * When Basis itself is launched from inside a Claude Code session, the host's
 * session variables (auth proxy, session ids) leak into the agent and break its
 * login. Drop them so the agent authenticates like a fresh CLI.
 */
function agentEnv(): NodeJS.ProcessEnv {
  if (!process.env.CLAUDECODE) return process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "CLAUDECODE" || key === "ANTHROPIC_BASE_URL" || key === "BAGGAGE" || key.startsWith("CLAUDE_")) continue;
    env[key] = value;
  }
  return env;
}

/** Tool kinds that are auto-approved when every touched path is inside the workspace. */
const SAFE_KINDS = new Set(["read", "edit", "search", "think"]);
const MAX_AUTO_FIXES = 2;

type Events = { agent: [AgentState]; chat: [ChatItem]; "chat-reset": [] };

/**
 * Runs one ACP agent as a subprocess and acts as its client: streams session
 * updates into a chat transcript, serves file reads/writes inside the
 * workspace and routes permission requests to the browser.
 */
export class AgentHost extends EventEmitter<Events> {
  private state: AgentState;
  private transcript: ChatItem[] = [];
  private proc?: ChildProcess;
  private connection?: acp.ClientConnection;
  private sessionId?: string;
  private supportsSystemPrompt = false;
  private needsPreamble = false;
  private openText?: { id: string; kind: "agent" | "thought" };
  private permissions = new Map<string, (optionId: string | null) => void>();
  private stderrTail: string[] = [];
  private autoFixes = 0;
  private seq = 0;

  constructor(
    private readonly workspace: Workspace,
    agentId: AgentId,
  ) {
    super();
    this.state = { id: agentId, status: "stopped" };
  }

  get agent(): AgentState {
    return this.state;
  }

  get chat(): ChatItem[] {
    return this.transcript;
  }

  async start(agentId: AgentId = this.state.id): Promise<void> {
    await this.stop();
    this.setState({ id: agentId, status: "starting", detail: "Starting agent…" });
    const spec = launchSpec(agentId);
    const proc = spawn(spec.command, spec.args, {
      cwd: this.workspace.dir,
      shell: spec.shell,
      stdio: ["pipe", "pipe", "pipe"],
      env: agentEnv(),
      windowsHide: true,
    });
    this.proc = proc;
    this.stderrTail = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-20);
    });
    proc.on("error", (error) => {
      if (this.proc === proc) this.fail(`Could not start ${agentId}: ${error.message}`);
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.connection = undefined;
      this.sessionId = undefined;
      const tail = this.stderrTail.slice(-3).join(" ");
      this.fail(`The agent exited (code ${code ?? "?"}).${tail ? ` ${tail}` : ""}`);
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
    );
    const app = acp
      .client({ name: "basis" })
      .onNotification(acp.methods.client.session.update, (ctx) => this.onUpdate(ctx.params))
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => this.onPermission(ctx.params))
      .onRequest(acp.methods.client.fs.readTextFile, (ctx) => this.readTextFile(ctx.params))
      .onRequest(acp.methods.client.fs.writeTextFile, (ctx) => this.writeTextFile(ctx.params));
    const connection = app.connect(stream);
    this.connection = connection;

    try {
      const init = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "basis", version: "0.1.0" },
      });
      this.supportsSystemPrompt = Boolean(init.agentCapabilities?.sessionCapabilities?.systemPrompt);
      const supportsImages = Boolean(init.agentCapabilities?.promptCapabilities?.image);
      await this.openSession();
      this.setState({ id: agentId, status: "ready", supportsImages });
    } catch (error) {
      if (this.proc === proc) this.fail(describeError(error, spec.loginHint));
    }
  }

  async stop(): Promise<void> {
    this.cancelPermissions();
    const proc = this.proc;
    this.proc = undefined;
    this.connection?.close();
    this.connection = undefined;
    this.sessionId = undefined;
    if (proc?.pid && proc.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      else proc.kill();
    }
    this.setState({ ...this.state, status: "stopped", detail: undefined });
  }

  async newSession(): Promise<void> {
    if (this.state.status === "busy") await this.cancel();
    this.transcript = [];
    this.openText = undefined;
    this.emit("chat-reset");
    if (!this.connection) return this.start();
    try {
      await this.openSession();
      this.setState({ ...this.state, status: "ready", detail: undefined });
    } catch (error) {
      this.fail(describeError(error, launchSpec(this.state.id).loginHint));
    }
  }

  async prompt(text: string, attachments: Attachments = {}, auto = false): Promise<void> {
    const connection = this.connection;
    const sessionId = this.sessionId;
    if (!connection || !sessionId || this.state.status !== "ready") return;
    if (!auto) this.autoFixes = 0;
    const images = this.state.supportsImages ? acceptedImages(attachments.images) : [];
    const annotations = attachments.annotations ?? [];
    this.push({
      kind: "user",
      id: this.nextId("user"),
      text,
      auto,
      images: images.length ? images.map((image) => `data:${image.mimeType};base64,${image.data}`) : undefined,
      annotations: annotations.length ? annotations.map(annotationLabel) : undefined,
    });
    this.setState({ ...this.state, status: "busy", detail: undefined });
    this.workspace.beginTurn(text || annotations.map(annotationLabel).join(", ") || "Image prompt");
    const message = text || "See the attached context.";
    const body = this.needsPreamble ? `${FIRST_PROMPT_PREAMBLE}

${message}` : message;
    this.needsPreamble = false;
    const blocks: acp.ContentBlock[] = [];
    if (annotations.length) blocks.push({ type: "text", text: formatAnnotations(annotations) });
    for (const image of images) blocks.push({ type: "image", mimeType: image.mimeType, data: image.data });
    blocks.push({ type: "text", text: body });
    try {
      const result = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: blocks,
      });
      if (result.stopReason === "cancelled") this.notice("Stopped.", "info");
      else if (result.stopReason !== "end_turn") this.notice(`The agent stopped early (${result.stopReason}).`, "error");
    } catch (error) {
      if (this.connection === connection) this.notice(describeError(error), "error");
    } finally {
      this.openText = undefined;
      this.cancelPermissions();
      if (this.connection === connection) this.setState({ ...this.state, status: "ready" });
    }
    // Pick up the final file state, record one undo step, and make sure the turn left a valid file behind.
    await this.workspace.endTurn();
    const errors = this.workspace.state.errors;
    if (errors && this.connection === connection && this.autoFixes < MAX_AUTO_FIXES) {
      this.autoFixes += 1;
      await this.prompt(
        `design-system.json no longer passes validation, so the preview is still showing the previous version. Fix these errors:\n${errors.map((e) => `- ${e}`).join("\n")}`,
        {},
        true,
      );
    }
  }

  async cancel(): Promise<void> {
    this.cancelPermissions();
    if (this.connection && this.sessionId) {
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
    }
  }

  resolvePermission(id: string, optionId: string | null): void {
    this.permissions.get(id)?.(optionId);
  }

  private async openSession(): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error("Agent is not connected");
    const base = { cwd: this.workspace.dir, mcpServers: [] };
    let response: acp.NewSessionResponse | undefined;
    if (this.supportsSystemPrompt) {
      try {
        response = await connection.agent.request(acp.methods.agent.session.new, {
          ...base,
          systemPrompt: { mode: "append", content: [{ type: "text", text: AGENT_BRIEF }] },
        });
      } catch {
        // Fall back to the preamble below; some agents advertise only "override".
      }
    }
    this.needsPreamble = response === undefined;
    const session = response ?? (await connection.agent.request(acp.methods.agent.session.new, base));
    if (!session?.sessionId) throw new Error("The agent did not return a session id");
    this.sessionId = session.sessionId;
  }

  private onUpdate(params: acp.SessionNotification): void {
    if (params.sessionId !== this.sessionId) return;
    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (update.content.type !== "text") return;
        this.appendText(update.sessionUpdate === "agent_message_chunk" ? "agent" : "thought", update.content.text);
        return;
      }
      case "tool_call": {
        this.push({
          kind: "tool",
          id: `tool-${update.toolCallId}`,
          title: update.title,
          toolKind: update.kind ?? "other",
          status: update.status ?? "pending",
        });
        return;
      }
      case "tool_call_update": {
        const id = `tool-${update.toolCallId}`;
        const existing = this.transcript.find((item) => item.id === id);
        if (existing?.kind !== "tool") return;
        this.push({
          ...existing,
          title: update.title ?? existing.title,
          toolKind: update.kind ?? existing.toolKind,
          status: (update.status as ToolStatus | null | undefined) ?? existing.status,
        });
        return;
      }
      case "plan": {
        const entries = update.entries.map((entry) => ({ content: entry.content, status: entry.status }));
        const last = this.transcript.findLast((item) => item.kind === "plan" || item.kind === "user");
        const id = last?.kind === "plan" ? last.id : this.nextId("plan");
        this.push({ kind: "plan", id, entries });
        return;
      }
      default:
        return;
    }
  }

  private async onPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const call = params.toolCall;
    const paths = (call.locations ?? []).map((location) => location.path);
    const options: PermissionChoice[] = params.options.map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    }));
    const autoAllow =
      call.kind != null && SAFE_KINDS.has(call.kind) && paths.length > 0 && paths.every((p) => this.workspace.isInside(p));
    const allowOnce = options.find((option) => option.kind === "allow_once");
    if (autoAllow && allowOnce) return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };

    const id = this.nextId("permission");
    const title = call.title ?? "The agent wants to run a tool";
    const detail = describeRawInput(call.rawInput) ?? (paths.length ? paths.join("\n") : undefined);
    this.push({ kind: "permission", id, title, detail, options });
    const optionId = await new Promise<string | null>((resolve) => this.permissions.set(id, resolve));
    this.permissions.delete(id);
    const chosen = options.find((option) => option.optionId === optionId);
    this.push({ kind: "permission", id, title, detail, options, resolved: chosen?.name ?? "Cancelled" });
    return chosen
      ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  private async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const text = await readFile(params.path, "utf8");
    if (params.line == null && params.limit == null) return { content: text };
    const lines = text.split("\n");
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + params.limit;
    return { content: lines.slice(start, end).join("\n") };
  }

  private async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    if (!this.workspace.isInside(params.path)) {
      throw new Error(`Basis only lets the agent write inside its workspace (${this.workspace.dir}).`);
    }
    await mkdir(path.dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content);
    return {};
  }

  private appendText(kind: "agent" | "thought", chunk: string): void {
    const open = this.openText;
    const current = open?.kind === kind ? this.transcript.find((item) => item.id === open.id) : undefined;
    if (current && (current.kind === "agent" || current.kind === "thought")) {
      this.push({ ...current, text: current.text + chunk }, true);
      return;
    }
    const id = this.nextId(kind);
    this.push({ kind, id, text: chunk }, true);
    this.openText = { id, kind };
  }

  /** Inserts or replaces a transcript item and broadcasts it. */
  private push(item: ChatItem, keepTextOpen = false): void {
    if (!keepTextOpen) this.openText = undefined;
    const index = this.transcript.findIndex((existing) => existing.id === item.id);
    if (index === -1) this.transcript.push(item);
    else this.transcript[index] = item;
    this.emit("chat", item);
  }

  private notice(text: string, tone: "info" | "error"): void {
    this.push({ kind: "notice", id: this.nextId("notice"), text, tone });
  }

  private fail(detail: string): void {
    this.cancelPermissions();
    void this.workspace.endTurn();
    this.setState({ ...this.state, status: "error", detail });
  }

  private cancelPermissions(): void {
    for (const resolve of this.permissions.values()) resolve(null);
    this.permissions.clear();
  }

  private setState(next: AgentState): void {
    this.state = next;
    this.emit("agent", next);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }
}

export interface Attachments {
  images?: PromptImage[];
  annotations?: Annotation[];
}

function acceptedImages(images: PromptImage[] | undefined): PromptImage[] {
  return (images ?? [])
    .filter(
      (image) =>
        (IMAGE_TYPES as readonly string[]).includes(image.mimeType) &&
        typeof image.data === "string" &&
        image.data.length <= MAX_IMAGE_BASE64,
    )
    .slice(0, MAX_IMAGES);
}

function describeRawInput(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  for (const key of ["command", "url", "file_path", "path", "pattern"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return undefined;
}

function describeError(error: unknown, loginHint?: string): string {
  const err = error as { code?: number; message?: string; data?: unknown };
  const message = err?.message ?? String(error);
  const needsAuth = err?.code === -32000 || /auth|login|logged in|credential/i.test(message);
  return needsAuth && loginHint ? `${message} ${loginHint}` : message;
}
