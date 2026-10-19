import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { LAYOUT_CHECK } from "../shared/layout.ts";
import { ALTERNATIVE_LABELS, describeTarget, MAX_ALTERNATIVES } from "../shared/review.ts";
import { loadChat, saveChat } from "./chatlog.ts";
import { PRODUCT_FILE, relativeInside } from "./paths.ts";
import { basisTool, basisToolTitle } from "./agent-tools.ts";
import { AGENT_BRIEF, FIRST_PROMPT_PREAMBLE } from "./brief.ts";
import { CLAUDE_MISSING, findClaude } from "./claude.ts";
import { codexEnv } from "./codex.ts";
import { isApprovableRead } from "./commands.ts";
import { isViewFile, unreported, type ScreenFinding } from "./stability.ts";
import type { Workspace } from "./workspace.ts";

interface LaunchSpec {
  command: string;
  args: string[];
  shell: boolean;
  loginHint: string;
  /** Variables the agent needs on top of Basis' own environment. */
  env?: Record<string, string>;
  /** Why the agent cannot start, shown instead of starting it. */
  missing?: string;
  /** Added when the agent exits on its own, for the failures an update fixes. */
  exitHint?: string;
}

/**
 * The adapters Basis was tested with, at fixed versions: an unpinned one would fetch whatever was published last.
 * npx fetches each on first use and reuses it after (--prefer-offline, so Basis also starts offline).
 */
const CLAUDE_ACP = "@agentclientprotocol/claude-agent-acp@0.92.0";
const CODEX_ACP = "@agentclientprotocol/codex-acp@2.2.2";

/**
 * How each supported agent is started. Both reuse the user's own CLI login, so no API keys are needed. `home` is
 * Basis' own folder (BASIS_HOME), where Codex gets a home of its own (server/codex.ts).
 */
function launchSpec(id: AgentId, home: string): LaunchSpec {
  // The end-to-end tests run a stand-in agent (test/e2e/fake-agent.mjs), since no CLI is logged in on CI.
  if (process.env.BASIS_AGENT_SCRIPT) {
    const script = path.resolve(process.env.BASIS_AGENT_SCRIPT);
    return { command: process.execPath, args: [script], shell: false, loginHint: "" };
  }
  if (id === "claude") {
    // Without --omit=optional the adapter's SDK brings its own copy of Claude Code; Basis runs the user's instead.
    const claude = findClaude();
    return {
      command: "npx",
      args: ["-y", "--prefer-offline", "--omit=optional", CLAUDE_ACP],
      shell: true,
      env: claude ? { CLAUDE_CODE_EXECUTABLE: claude } : undefined,
      missing: claude ? undefined : CLAUDE_MISSING,
      loginHint: "Run `claude` in a terminal and log in, then restart the agent.",
      exitHint: "If it keeps happening, update Claude Code with `claude update`.",
    };
  }
  const env = codexEnv(home);
  if (!env.CODEX_HOME)
    console.warn("[basis] Codex has no auth.json to share, so it runs in your own Codex home, with your AGENTS.md.");
  return {
    command: "npx",
    args: ["-y", "--prefer-offline", CODEX_ACP],
    shell: true,
    env,
    loginHint: "Run `codex login` in a terminal, then restart the agent.",
  };
}

/**
 * When Basis itself is launched from inside a Claude Code session, the host's
 * session variables (auth proxy, session ids) leak into the agent and break its
 * login. Drop them so the agent authenticates like a fresh CLI.
 */
function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const host = key === "CLAUDECODE" || key === "ANTHROPIC_BASE_URL" || key === "BAGGAGE" || key.startsWith("CLAUDE_");
    if (process.env.CLAUDECODE && host) continue;
    env[key] = value;
  }
  // Claude Code's auto memory lives outside the workspace and loads whatever SESSION_META says; Basis keeps its own.
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}

/** Tool kinds that are auto-approved when every touched path is inside the workspace. */
const SAFE_KINDS = new Set(["read", "edit", "search", "think"]);
/**
 * Claude Code loads the user's own ~/.claude by default: their CLAUDE.md, skills, hooks and permission rules, and
 * the claude.ai connectors of their login. Rules that allow commands there would run them without Basis asking, and
 * the rest is meant for their coding, not for designing here. So it loads none of them: not even the project
 * source, since it reads CLAUDE.md in every folder above the workspace, and ~/.claude/CLAUDE.md is one of those for
 * a workspace under the home folder. The brief arrives as the system prompt instead. Other agents ignore the key.
 */
const SESSION_META = {
  claudeCode: { options: { settingSources: [], strictMcpConfig: true, allowDangerouslySkipPermissions: false } },
};

/** The brief, appended to the agent's own system prompt where the agent supports that. */
const SYSTEM_PROMPT = { mode: "append" as const, content: [{ type: "text" as const, text: AGENT_BRIEF }] };

/**
 * SESSION_META with the linked repo as one of Claude Code's working directories, where its read and search tools and
 * its read-only shell commands (`ls`, `find`, `grep`) run without asking, as they do in the workspace; git commands
 * that name the folder still ask (Claude Code's own check), and edits ask, which Basis refuses. Not ACP's own
 * `additionalDirectories`: Codex makes those writable.
 */
export function sessionMeta(repo: string | undefined) {
  if (!repo) return SESSION_META;
  return { claudeCode: { options: { ...SESSION_META.claudeCode.options, additionalDirectories: [repo] } } };
}

/**
 * Per agent, the session mode in which it asks before every edit, so edits go through onPermission and Basis'
 * rules for what the agent may change. Codex's read-only mode still runs read-only commands in its sandbox unasked,
 * except on Windows, where Basis' Codex home has no sandbox (server/codex.ts) and every command asks; Basis then
 * approves the ones that only read the workspace or the linked repo (isCodexRead).
 */
const ASKING_MODES: Record<AgentId, string> = { claude: "default", codex: "read-only" };
const MAX_AUTO_FIXES = 2;
/** How long the fix loop waits at most for the gallery reloaded after a turn to report. */
const PREVIEW_RELOAD_MS = 10_000;
/** How long the fix loop waits at most for the preview's checks to finish after it reported. */
const CHECKS_WAIT_MS = 8000;

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
  /** Tool calls of Basis' own tools, by chat id: updates may come without the tool's name. */
  private basisCalls = new Map<string, string>();
  private stderrTail: string[] = [];
  private previewErrors: string[] = [];
  /** Findings of the preview's automatic checks, and the ones there were when the current turn started. */
  private checks: string[] = [];
  private checksBefore = new Set<string>();
  private checking = false;
  /** The generation of the reporting tab's preview document, or null when no tab reports (see server/hold.ts). */
  private previewGeneration: number | null = null;
  /** The generation the gallery reloaded after the last turn reports, or null when the turn changed nothing it shows. */
  private reloaded: number | null = null;
  private seq = 0;
  /** Prompts sent while a turn was running, oldest first. */
  private queued: { id: string; text: string; attachments: Attachments; alternatives: number }[] = [];
  /** Set by Stop; ends the current set of alternatives and the fix loop, not just the running turn. */
  private stopping = false;
  /** What to tell the user when the running agent's login fails (from its LaunchSpec). */
  private loginHint = "";
  /** View files whose screens the last check found wrong, checked again after the next fix-up turn. */
  private flaggedViews: string[] = [];
  /** The linked repo the open session was given as a working directory; a changed link reopens it (syncRepo). */
  private sessionRepo?: string;

  constructor(
    private readonly workspace: Workspace,
    agentId: AgentId,
    /** A product repo linked to the project: the agent may read and search it, never write to it. */
    private repo: string | undefined,
    /** MCP servers every session gets: Basis' own tools (server/agent-tools.ts). */
    private readonly mcpServers: acp.McpServer[],
    /** Basis' own folder (BASIS_HOME), where Codex gets a home of its own (server/codex.ts). */
    private readonly home: string,
    /** Checks that the views a turn changed render the same every time (server/stability.ts). */
    private readonly views?: { check(files: string[]): Promise<ScreenFinding[]> },
    /** Holds the preview's changes while a turn runs, and reloads the gallery when it ends (server/hold.ts). */
    private readonly preview?: { hold(): void; release(): number | null },
  ) {
    super();
    this.state = { id: agentId, status: "stopped" };
  }

  /** Resolves once the agent is ready for a prompt (true), or has failed or stopped instead (false). */
  whenReady(): Promise<boolean> {
    if (this.state.status === "ready") return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = (state: AgentState) => {
        if (state.status === "starting" || state.status === "busy") return;
        this.off("agent", check);
        resolve(state.status === "ready");
      };
      this.on("agent", check);
    });
  }

  /** Links or unlinks the product repo; the session gets it as a working directory from the next turn (syncRepo). */
  setRepo(repo: string | undefined): void {
    this.repo = repo;
  }

  private inRepo(target: string): boolean {
    return this.repo !== undefined && relativeInside(this.repo, target) !== null;
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
    const spec = launchSpec(agentId, this.home);
    this.loginHint = spec.loginHint;
    if (spec.missing) {
      this.fail(spec.missing);
      return;
    }
    // Through a shell, the command goes as one line: Node no longer accepts separate arguments there.
    const [command, args] = spec.shell ? [[spec.command, ...spec.args].join(" "), []] : [spec.command, spec.args];
    const proc = spawn(command, args, {
      cwd: this.workspace.dir,
      shell: spec.shell,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...agentEnv(), ...spec.env },
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
      const hint = spec.exitHint ? ` ${spec.exitHint}` : "";
      this.fail(`The agent exited (code ${code ?? "?"}).${tail ? ` ${tail}` : ""}${hint}`);
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
      this.fail(describeError(error, this.loginHint));
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
    this.flaggedViews = [];
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
    await this.syncRepo(connection, sessionId);
    await this.workspace.beginTurn(turn.label);
    // Each turn, the fix-ups included, holds the preview on its own: the fix loop needs to see each one's result.
    this.preview?.hold();
    this.checksBefore = new Set([...this.checks, ...this.workspace.state.colorFindings]);
    const message = turn.text || "See the attached context.";
    const body = this.needsPreamble
      ? `${FIRST_PROMPT_PREAMBLE}

${message}`
      : message;
    this.needsPreamble = false;
    const blocks: acp.ContentBlock[] = [];
    if (this.repo) {
      const hasNotes = existsSync(path.join(this.workspace.dir, PRODUCT_FILE));
      blocks.push({ type: "text", text: repoContext(this.repo, hasNotes) });
    }
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
      if (this.connection === connection) this.notice(describeError(error, this.loginHint), "error");
    } finally {
      this.openText = undefined;
      this.cancelPermissions();
    }
    // Stay busy while the turn is checked and recorded as one undo step.
    await this.workspace.endTurn();
    this.reloaded = this.preview?.release() ?? null;
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
  setPreviewErrors(
    errors: unknown[],
    checks: unknown[] = [],
    checking = false,
    generation: number | null = null,
  ): void {
    const strings = (items: unknown[], limit: number, length: number) =>
      items
        .filter((item): item is string => typeof item === "string")
        .slice(0, limit)
        .map((item) => item.slice(0, length));
    this.previewErrors = strings(errors, 10, 600);
    this.checks = strings(checks, 60, 400);
    this.checking = checking;
    this.previewGeneration = generation;
  }

  /**
   * Waits until the preview shows what the last turn left and has checked it: the first report from the gallery
   * reloaded after the turn (when the turn changed what it shows), then its checks. False when no tab reports, or
   * the reloaded gallery did not report in time; what the preview reported is then from before the turn.
   */
  private async previewSettled(): Promise<boolean> {
    const target = this.reloaded;
    const behind = () => target !== null && this.previewGeneration !== null && this.previewGeneration < target;
    for (let waited = 0; behind(); waited += 100) {
      if (waited >= PREVIEW_RELOAD_MS) {
        console.warn("[basis] the preview did not report after the turn, so its errors and checks are left out");
        return false;
      }
      await sleep(100);
    }
    if (this.previewGeneration === null) return false;
    // The checks run once the gallery has rendered; wait for them, so what the turn introduced is known.
    for (let waited = 0; this.checking && waited < CHECKS_WAIT_MS; waited += 200) await sleep(200);
    return true;
  }

  /** Everything the last turn left broken, phrased for the agent, or null when all is well. */
  private async collectProblems(): Promise<string | null> {
    const { errors, typeErrors, reviewErrors } = this.workspace.state;
    // Only after a turn that changed views/, and for the views found wrong before; it runs while the preview settles.
    const viewFiles = new Set([...this.workspace.turnFiles, ...this.flaggedViews].filter(isViewFile));
    const viewCheck = viewFiles.size && this.views ? this.views.check([...viewFiles]) : Promise.resolve([]);
    // Also with type errors: the report from before the gallery reloaded is stale, and what fails to render helps.
    const fresh = await this.previewSettled();
    const previewErrors = fresh ? this.previewErrors : [];
    const checks = fresh ? this.checks : [];
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
    const screens = unreported(await viewCheck, previewErrors);
    this.flaggedViews = screens.map((screen) => screen.file);
    const failedScreens = screens.filter((screen) => screen.kind === "failed").map((screen) => screen.text);
    const rendering = [...previewErrors, ...failedScreens];
    if (rendering.length) sections.push(`The preview fails to render:\n${list(rendering)}`);
    const unstable = screens.filter((screen) => screen.kind === "unstable").map((screen) => screen.text);
    if (unstable.length) {
      sections.push(
        `These view screens render differently each time Basis captures them (twice, the second time with the clock a day later), so no implementation can ever match them pixel for pixel. Make each one render the same every time: fixed dates and data, no random values, nothing that keeps moving:\n${list(unstable)}`,
      );
    }
    // Only what this turn introduced: findings that were there before are the user's to ask about, and
    // repeating them would send the agent after them on every turn.
    const introduced = checks.filter((check) => !this.checksBefore.has(check));
    const layout = introduced.filter((check) => check.startsWith(`${LAYOUT_CHECK}: `));
    const accessibility = introduced.filter((check) => !layout.includes(check));
    if (accessibility.length) {
      sections.push(
        `Your change fails these accessibility checks (WCAG 2 AA). Fix them, unless the user asked for exactly this; then say so instead:\n${list(accessibility)}`,
      );
    }
    if (layout.length) {
      sections.push(
        `Your change breaks the layout of these demos at the widths named (Basis checks every demo at 375px as well as at the widths the gallery shows). Look at each with the screenshot tool at that width, fix it and look again, unless the user asked for exactly this; then say so instead:\n${list(layout)}`,
      );
    }
    const fixedColors = this.workspace.state.colorFindings.filter((finding) => !this.checksBefore.has(finding));
    if (fixedColors.length) {
      sections.push(
        `Your change uses colours that stay the same in light and dark, so they will look wrong in one of them. Derive them from the colour roles (var(--color-...), color-mix() with a role, oklch(from var(--color-...) ...)), or add the colour to both themes, unless the user asked for exactly this; then say so instead:\n${list(fixedColors)}`,
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
    const base = this.sessionBase();
    const saved = resume ? this.resumable : undefined;
    this.resumable = undefined;
    if (saved && saved.agent === this.state.id && this.supportsResume) {
      try {
        const resumed = await connection.agent.request(acp.methods.agent.session.resume, {
          ...base,
          sessionId: saved.sessionId,
          ...(this.supportsSystemPrompt ? { systemPrompt: SYSTEM_PROMPT } : {}),
        });
        await this.askingMode(connection, saved.sessionId, (resumed as acp.ResumeSessionResponse | undefined)?.modes);
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
        response = await connection.agent.request(acp.methods.agent.session.new, {
          ...base,
          systemPrompt: SYSTEM_PROMPT,
        });
      } catch {
        // Fall back to the preamble below; some agents advertise only "override".
      }
    }
    this.needsPreamble = response === undefined;
    const session = response ?? (await connection.agent.request(acp.methods.agent.session.new, base));
    if (!session?.sessionId) throw new Error("The agent did not return a session id");
    await this.askingMode(connection, session.sessionId, session.modes);
    this.sessionId = session.sessionId;
    this.scheduleSave();
  }

  /** What every session is opened with; `sessionRepo` remembers the repo it names. */
  private sessionBase() {
    this.sessionRepo = this.repo;
    return { cwd: this.workspace.dir, mcpServers: this.mcpServers, _meta: sessionMeta(this.repo) };
  }

  /**
   * Gives the open session the repo linked now, before a turn. Claude Code reads its working directories only when
   * its session starts; resuming the live session with different ones makes the adapter rebuild it from its
   * transcript, so the conversation goes on. Other agents are not given the repo this way (sessionMeta).
   */
  private async syncRepo(connection: acp.ClientConnection, sessionId: string): Promise<void> {
    if (this.repo === this.sessionRepo) return;
    const base = this.sessionBase();
    if (this.state.id !== "claude" || !this.supportsResume) return;
    try {
      const resumed = await connection.agent.request(acp.methods.agent.session.resume, {
        ...base,
        sessionId,
        ...(this.supportsSystemPrompt ? { systemPrompt: SYSTEM_PROMPT } : {}),
      });
      await this.askingMode(connection, sessionId, (resumed as acp.ResumeSessionResponse | undefined)?.modes);
    } catch (error) {
      // The session goes on as it was: reads in the repo still work, its shell commands ask.
      console.warn("[basis] could not give the agent the linked repo:", describeError(error));
    }
  }

  /**
   * Agents start in the user's own default mode (Claude Code's from ~/.claude, whatever SESSION_META says; Codex's
   * from its config), and one that edits or runs commands unasked would act without Basis' rules. The session
   * starts in the mode that asks instead (ASKING_MODES).
   */
  private async askingMode(
    connection: acp.ClientConnection,
    sessionId: string,
    modes: acp.SessionModeState | null | undefined,
  ): Promise<void> {
    const asking = ASKING_MODES[this.state.id];
    if (!modes || modes.currentModeId === asking) return;
    if (!modes.availableModes.some((mode) => mode.id === asking)) return;
    await connection.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: asking });
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
        const tool = basisTool(update);
        if (tool) this.basisCalls.set(`tool-${update.toolCallId}`, tool);
        this.push({
          kind: "tool",
          id: `tool-${update.toolCallId}`,
          title: tool ? basisToolTitle(tool, update.rawInput) : update.title,
          toolKind: update.kind ?? "other",
          status: update.status ?? "pending",
        });
        return;
      }
      case "tool_call_update": {
        const id = `tool-${update.toolCallId}`;
        const existing = this.transcript.find((item) => item.id === id);
        if (existing?.kind !== "tool") return;
        const tool = basisTool(update) ?? this.basisCalls.get(id);
        const title = tool
          ? update.rawInput !== undefined
            ? basisToolTitle(tool, update.rawInput)
            : existing.title
          : (update.title ?? existing.title);
        this.push({
          ...existing,
          title,
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
    // Some tools (grep) name their path only in their input, not as locations.
    const located = (call.locations ?? []).map((location) => location.path);
    const paths = located.length ? located : inputPaths(call.rawInput, this.workspace.dir);
    const options: PermissionChoice[] = params.options.map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    }));
    // Reads may also look in the linked product repo; edits stay inside what the workspace lets the agent change.
    const allowed = (p: string) =>
      call.kind === "edit" ? this.workspace.isEditable(p) : this.workspace.isInside(p) || this.inRepo(p);
    const autoAllow = call.kind != null && SAFE_KINDS.has(call.kind) && paths.length > 0 && paths.every(allowed);
    const allowOnce = options.find((option) => option.kind === "allow_once");
    // Basis' own tools only look at the design, so they need no approval.
    const ownTool = basisTool(call) ?? this.basisCalls.get(`tool-${call.toolCallId}`);
    if ((autoAllow || ownTool || this.isCodexRead(call)) && allowOnce)
      return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    // The linked repo is read-only, though Claude Code has it as a working directory: edits there are refused unasked.
    const inProduct = paths.find((p) => this.inRepo(p) && relativeInside(this.workspace.dir, p) === null);
    if (call.kind === "edit" && inProduct) {
      this.notice(`Basis refused an edit in the linked product repo (${inProduct}); the agent only reads it.`, "info");
      const reject = options.find((option) => option.kind === "reject_once");
      return reject
        ? { outcome: { outcome: "selected", optionId: reject.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

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

  /**
   * A command Codex asks to run that only reads the workspace or the linked repo, as Claude Code's reads do there.
   * Codex reports every command, reads included, as `execute`; the approval request carries the command line and
   * its folder (`server/commands.ts` decides from those), and the paths Codex itself saw in it as locations, which
   * must be readable too. Claude Code decides about its own read-only shell commands in its working directories
   * (sessionMeta); the rest of its commands ask.
   */
  private isCodexRead(call: acp.RequestPermissionRequest["toolCall"]): boolean {
    if (this.state.id !== "codex" || call.kind !== "execute") return false;
    const readable = (target: string) => relativeInside(this.workspace.dir, target) !== null || this.inRepo(target);
    const located = (call.locations ?? []).every((location) => readable(location.path));
    return located && isApprovableRead(call.rawInput, this.workspace.dir, readable);
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
        "Basis only lets the agent write design-system.json, review.json, product.md and files under components/, patterns/ or views/ in its workspace.",
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
    void this.workspace.endTurn().then(() => this.preview?.release());
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

/** Tells the agent about the product repo linked to the project, on every turn. */
function repoContext(repo: string, hasNotes: boolean): string {
  return [
    `This project designs for a product whose repo is linked in Basis: ${repo} (read-only; see "A linked product repo" in AGENTS.md).`,
    hasNotes
      ? "What is known about it is in product.md: read that first, look in the repo only for what it does not cover, and add what you learn."
      : "There is no product.md yet: when you learn something about the product worth keeping, write it there.",
  ].join(" ");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** The paths a tool's raw input names (path, file_path), resolved against the workspace. */
function inputPaths(raw: unknown, dir: string): string[] {
  if (!raw || typeof raw !== "object") return [];
  const input = raw as Record<string, unknown>;
  return ["path", "file_path"]
    .map((key) => input[key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => path.resolve(dir, value));
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
  if (/usage limit|rate limit|too many requests|\b429\b/i.test(message))
    return `${message} That is your plan's usage limit; it resets after a while, and Basis keeps the conversation until then.`;
  const needsAuth = err?.code === -32000 || /auth|login|logged in|credential/i.test(message);
  return needsAuth && loginHint ? `${message} ${loginHint}` : message;
}
