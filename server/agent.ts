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
import { ALTERNATIVE_LABELS, describeTarget, MAX_ALTERNATIVES } from "../shared/review.ts";
import { loadChat, saveChat } from "./chatlog.ts";
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
    if (key === "CLAUDECODE" || key === "ANTHROPIC_BASE_URL" || key === "BAGGAGE" || key.startsWith("CLAUDE_"))
      continue;
    env[key] = value;
  }
  return env;
}

/** Tool kinds that are auto-approved when every touched path is inside the workspace. */
const SAFE_KINDS = new Set(["read", "edit", "search", "think"]);
const MAX_AUTO_FIXES = 2;
const PREVIEW_SETTLE_MS = 1500;

type Events = { agent: [AgentState]; chat: [ChatItem]; "chat-remove": [string]; "chat-reset": [] };
type UserItem = Extract<ChatItem, { kind: "user" }>;

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
  private supportsResume = false;
  /** The saved session the next start tries to resume, from the conversation saved before a restart. */
  private resumable?: { agent: AgentId; sessionId: string };
  private saveTimer?: NodeJS.Timeout;
  private needsPreamble = false;
  private openText?: { id: string; kind: "agent" | "thought" };
  private permissions = new Map<string, (optionId: string | null) => void>();
  private stderrTail: string[] = [];
  private previewErrors: string[] = [];
  /** Findings of the preview's automatic checks, and the ones there were when the current turn started. */
  private checks: string[] = [];
  private checksBefore = new Set<string>();
  private seq = 0;
  /** Prompts sent while a turn was running, oldest first. */
  private queued: { id: string; text: string; attachments: Attachments; alternatives: number }[] = [];
  /** Set by Stop; ends the current set of alternatives and the fix loop, not just the running turn. */
  private stopping = false;

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

  /** Brings back the conversation saved before the last restart; the next start tries to resume its session. */
  async restore(): Promise<void> {
    const saved = await loadChat(this.workspace.dir);
    if (!saved) return;
    this.transcript = saved.chat;
    if (saved.sessionId) this.resumable = { agent: saved.agent, sessionId: saved.sessionId };
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
      this.supportsResume = Boolean(init.agentCapabilities?.sessionCapabilities?.resume);
      const supportsImages = Boolean(init.agentCapabilities?.promptCapabilities?.image);
      await this.openSession(true);
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
      if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      else proc.kill();
    }
    this.setState({ ...this.state, status: "stopped", detail: undefined });
  }

  async newSession(): Promise<void> {
    if (this.state.status === "busy") await this.cancel();
    this.queued = [];
    this.transcript = [];
    this.openText = undefined;
    this.resumable = undefined;
    this.emit("chat-reset");
    this.scheduleSave();
    if (!this.connection) return this.start();
    try {
      await this.openSession();
      this.setState({ ...this.state, status: "ready", detail: undefined });
    } catch (error) {
      this.fail(describeError(error, launchSpec(this.state.id).loginHint));
    }
  }

  /**
   * Runs what the user sent: one turn, or with `alternatives` > 1 that many
   * takes on it to choose between. A prompt sent while the agent works is
   * queued and runs when it is free again; `queuedId` is the chat item it was
   * queued as.
   */
  async prompt(text: string, attachments: Attachments = {}, queuedId?: string, alternatives = 1): Promise<void> {
    const connection = this.connection;
    if (!connection || !this.sessionId) return;
    const count = Math.max(1, Math.min(MAX_ALTERNATIVES, Math.floor(alternatives) || 1));
    if (this.state.status === "busy") return this.enqueue(text, attachments, count);
    if (this.state.status !== "ready") return;
    this.stopping = false;
    this.setState({ ...this.state, status: "busy", detail: undefined });
    const images = this.state.supportsImages ? acceptedImages(attachments.images) : [];
    const annotations = attachments.annotations ?? [];
    this.push({
      ...this.userItem(queuedId ?? this.nextId("user"), text, images, annotations, false),
      alternatives: count > 1 ? count : undefined,
    });
    const label = text || annotations.map(annotationLabel).join(", ") || "Image prompt";
    const turn = { text, images, annotations, label, instruction: attachments.instruction };
    if (count > 1) await this.runAlternatives(turn, count);
    else await this.runChecked(turn);
    if (this.connection === connection) this.setState({ ...this.state, status: "ready" });
    // Whatever the user queued meanwhile runs once everything above is done.
    await this.runQueued();
  }

  /** One turn plus the fix-up turns for what it left broken. Returns false when it was stopped or failed. */
  private async runChecked(turn: Turn): Promise<boolean> {
    const connection = this.connection;
    const completed = await this.runTurn(turn);
    for (let fixes = 0; completed && fixes < MAX_AUTO_FIXES && !this.stopping; fixes += 1) {
      const problems = await this.collectProblems();
      if (!problems || this.connection !== connection) break;
      this.push(this.userItem(this.nextId("user"), problems, [], [], true));
      // Fix-up turns are labelled as such in history and reviews, not with the whole problem report.
      await this.runTurn({ text: problems, images: [], annotations: [], label: "Fixed reported problems" });
    }
    return completed && !this.stopping;
  }

  /**
   * Makes `count` takes on one prompt, each from the same starting point, for
   * the user to compare in a review and pick from. Between takes Basis puts the
   * workspace back; the agent's session remembers the earlier takes, so it can
   * make the next one different.
   */
  private async runAlternatives(turn: Turn, count: number): Promise<void> {
    const labels = ALTERNATIVE_LABELS.slice(0, count);
    await this.workspace.beginAlternatives(turn.label, count);
    for (const [index, label] of labels.entries()) {
      if (index > 0) {
        if (!this.workspace.review?.alternatives || this.stopping || !this.connection) break;
        await this.workspace.nextAlternative();
      }
      this.notice(`Alternative ${label} of ${count}`, "info");
      const completed = await this.runChecked({
        ...turn,
        label: `Alternative ${label}: ${turn.label}`,
        instruction: [turn.instruction, alternativeInstruction(index, labels, Boolean(this.workspace.review))]
          .filter(Boolean)
          .join("\n\n"),
      });
      if (!(await this.workspace.alternativeDone(label))) {
        if (index === 0)
          this.notice(
            "The agent made one version without opening a review, so there is nothing to compare it with.",
            "info",
          );
        break;
      }
      if (!completed) break;
    }
    await this.workspace.endAlternatives();
  }

  /** Sends one turn to the agent and records what it changed as one undo step (or iteration). */
  private async runTurn(turn: Turn): Promise<boolean> {
    const connection = this.connection;
    const sessionId = this.sessionId;
    if (!connection || !sessionId) return false;
    await this.workspace.beginTurn(turn.label);
    this.checksBefore = new Set(this.checks);
    const message = turn.text || "See the attached context.";
    const body = this.needsPreamble
      ? `${FIRST_PROMPT_PREAMBLE}

${message}`
      : message;
    this.needsPreamble = false;
    const blocks: acp.ContentBlock[] = [];
    const context = this.reviewContext();
    if (context) blocks.push({ type: "text", text: context });
    if (turn.instruction) blocks.push({ type: "text", text: turn.instruction });
    if (turn.annotations.length) blocks.push({ type: "text", text: formatAnnotations(turn.annotations) });
    for (const image of turn.images) blocks.push({ type: "image", mimeType: image.mimeType, data: image.data });
    blocks.push({ type: "text", text: body });
    let completed = false;
    try {
      const result = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: blocks,
      });
      completed = result.stopReason === "end_turn";
      if (result.stopReason === "cancelled") this.notice("Stopped.", "info");
      else if (!completed) this.notice(`The agent stopped early (${result.stopReason}).`, "error");
    } catch (error) {
      if (this.connection === connection) this.notice(describeError(error), "error");
    } finally {
      this.openText = undefined;
      this.cancelPermissions();
    }
    // Stay busy while the turn is checked and recorded as one undo step.
    await this.workspace.endTurn();
    return completed && this.connection === connection;
  }

  /** Removes a queued prompt before it runs. */
  unqueue(id: string): void {
    const before = this.queued.length;
    this.queued = this.queued.filter((item) => item.id !== id);
    if (this.queued.length !== before) this.remove(id);
  }

  private enqueue(text: string, attachments: Attachments, alternatives: number): void {
    const id = this.nextId("user");
    const images = this.state.supportsImages ? acceptedImages(attachments.images) : [];
    this.push({
      ...this.userItem(id, text, images, attachments.annotations ?? [], false),
      queued: true,
      alternatives: alternatives > 1 ? alternatives : undefined,
    });
    this.queued.push({ id, text, attachments, alternatives });
  }

  private async runQueued(): Promise<void> {
    const next = this.queued.shift();
    if (!next) return;
    // The message moves from where it was queued to the end of the conversation, where its turn starts.
    this.remove(next.id);
    await this.prompt(next.text, next.attachments, next.id, next.alternatives);
  }

  private clearQueue(): void {
    for (const item of this.queued) this.remove(item.id);
    this.queued = [];
  }

  private userItem(
    id: string,
    text: string,
    images: PromptImage[],
    annotations: Annotation[],
    auto: boolean,
  ): UserItem {
    return {
      kind: "user",
      id,
      text,
      auto,
      images: images.length ? images.map((image) => `data:${image.mimeType};base64,${image.data}`) : undefined,
      annotations: annotations.length ? annotations.map(annotationLabel) : undefined,
    };
  }

  /** Tells the agent about the open review on every turn, so its changes stay about what the review shows. */
  private reviewContext(): string | null {
    const review = this.workspace.review;
    if (!review) return null;
    return [
      `A review is open in Basis: "${review.title}", showing ${review.show.map(describeTarget).join("; ")}.`,
      "Everything you change now belongs to this review until the user approves or discards it in Basis.",
      "Keep review.json pointing at what the user is asking about, and update it when the focus moves.",
    ].join(" ");
  }

  /**
   * Render errors and check findings of the current tab's preview (chosen by PreviewReports); they feed the
   * auto-fix loop.
   */
  setPreviewErrors(errors: unknown[], checks: unknown[] = []): void {
    const strings = (items: unknown[], limit: number, length: number) =>
      items
        .filter((item): item is string => typeof item === "string")
        .slice(0, limit)
        .map((item) => item.slice(0, length));
    this.previewErrors = strings(errors, 10, 600);
    this.checks = strings(checks, 40, 400);
  }

  /** Everything the last turn left broken, phrased for the agent, or null when all is well. */
  private async collectProblems(): Promise<string | null> {
    const { errors, typeErrors, reviewErrors } = this.workspace.state;
    // Give the preview a moment to hot-reload the new code and report what failed to render.
    if (!errors && !typeErrors) await new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS));
    const sections: string[] = [];
    if (reviewErrors)
      sections.push(`review.json is not valid, so no review was opened or updated:\n${list(reviewErrors)}`);
    if (errors)
      sections.push(
        `design-system.json does not validate, so the preview still shows the previous version:\n${list(errors)}`,
      );
    if (typeErrors) {
      sections.push(
        `The source does not type-check, or no longer satisfies the contracts (.basis/contracts.ts and components/contracts.ts):\n${list(typeErrors)}`,
      );
    }
    if (this.previewErrors.length) sections.push(`The preview fails to render:\n${list(this.previewErrors)}`);
    // Only what this turn introduced: findings that were there before are the user's to ask about, and
    // repeating them would send the agent after them on every turn.
    const introduced = this.checks.filter((check) => !this.checksBefore.has(check));
    if (introduced.length) {
      sections.push(
        `Your change fails these accessibility checks (WCAG 2 AA). Fix them, unless the user asked for exactly this; then say so instead:\n${list(introduced)}`,
      );
    }
    return sections.length
      ? `Your last change left problems. Fix them before anything else.\n\n${sections.join("\n\n")}`
      : null;
  }

  /** Stops the running turn; prompts queued behind it are dropped too, since Stop means stop. */
  async cancel(): Promise<void> {
    this.stopping = true;
    this.clearQueue();
    this.cancelPermissions();
    if (this.connection && this.sessionId) {
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
    }
  }

  resolvePermission(id: string, optionId: string | null): void {
    this.permissions.get(id)?.(optionId);
  }

  /**
   * Opens the session turns run in. With `resume`, it first tries to pick up
   * the saved session, so the agent remembers the conversation the transcript
   * shows; otherwise, or when that fails, it starts a new one.
   */
  private async openSession(resume = false): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error("Agent is not connected");
    const base = { cwd: this.workspace.dir, mcpServers: [] };
    const systemPrompt = { mode: "append" as const, content: [{ type: "text" as const, text: AGENT_BRIEF }] };
    const saved = resume ? this.resumable : undefined;
    this.resumable = undefined;
    if (saved && saved.agent === this.state.id && this.supportsResume) {
      try {
        await connection.agent.request(acp.methods.agent.session.resume, {
          ...base,
          sessionId: saved.sessionId,
          ...(this.supportsSystemPrompt ? { systemPrompt } : {}),
        });
        this.sessionId = saved.sessionId;
        this.needsPreamble = false;
        this.scheduleSave();
        return;
      } catch {
        // Falls through to a new session below.
      }
    }
    if (saved && this.transcript.length > 0) {
      this.notice(
        "The agent starts a new conversation after the restart; the messages above are for reference.",
        "info",
      );
    }
    let response: acp.NewSessionResponse | undefined;
    if (this.supportsSystemPrompt) {
      try {
        response = await connection.agent.request(acp.methods.agent.session.new, { ...base, systemPrompt });
      } catch {
        // Fall back to the preamble below; some agents advertise only "override".
      }
    }
    this.needsPreamble = response === undefined;
    const session = response ?? (await connection.agent.request(acp.methods.agent.session.new, base));
    if (!session?.sessionId) throw new Error("The agent did not return a session id");
    this.sessionId = session.sessionId;
    this.scheduleSave();
  }

  /** Saves the conversation shortly after it changes; streamed text changes it many times a second. */
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const saved = { agent: this.state.id, sessionId: this.sessionId ?? null, chat: this.transcript };
      saveChat(this.workspace.dir, saved).catch((error: Error) =>
        console.error("[basis] could not save the chat:", error.message),
      );
    }, 400);
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
    const allowed = (p: string) => (call.kind === "edit" ? this.workspace.isEditable(p) : this.workspace.isInside(p));
    const autoAllow = call.kind != null && SAFE_KINDS.has(call.kind) && paths.length > 0 && paths.every(allowed);
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
    if (!this.workspace.isEditable(params.path)) {
      throw new Error(
        "Basis only lets the agent write design-system.json, review.json and files under components/ or patterns/ in its workspace.",
      );
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
    this.scheduleSave();
  }

  private remove(id: string): void {
    this.transcript = this.transcript.filter((item) => item.id !== id);
    this.emit("chat-remove", id);
    this.scheduleSave();
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

/** What one turn sends: the user's words and attachments, and how history labels it. */
interface Turn {
  text: string;
  images: PromptImage[];
  annotations: Annotation[];
  label: string;
  instruction?: string;
}

/**
 * Tells the agent which take it is making. The first one also opens the
 * review the takes are compared in, unless one is open already.
 */
function alternativeInstruction(index: number, labels: readonly string[], reviewOpen: boolean): string {
  const label = labels[index];
  if (index === 0) {
    return [
      `The user asked for ${labels.length} alternatives of this change (${labels.join(", ")}), to compare side by side and pick one to continue with.`,
      `Make alternative ${label} now; Basis then puts the workspace back and asks for the next one.`,
      "Make each alternative a complete, clearly different take on the request (a different direction, not a small variation of the same idea).",
      reviewOpen
        ? ""
        : "Write review.json first, showing what the alternatives change: Basis compares them in that review, and without it there is nothing to compare.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `Basis has put the workspace back to where alternative ${labels[0]} started.`,
    `Make alternative ${label} now: a clearly different take on the same request from ${labels.slice(0, index).join(" and ")}, which the user will see next to it.`,
    "Leave review.json as it is unless what the review shows has to change.",
  ].join(" ");
}

export interface Attachments {
  images?: PromptImage[];
  annotations?: Annotation[];
  /** Instructions sent to the agent ahead of the prompt but not shown in the chat (guided turns). */
  instruction?: string;
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

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
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
