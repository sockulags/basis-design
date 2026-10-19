import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { annotationLabel, formatAnnotations, type Annotation } from "../shared/annotations.ts";
import {
  AGENT_LABELS,
  IMAGE_TYPES,
  MAX_IMAGE_BASE64,
  MAX_IMAGES,
  type AgentId,
  type AgentState,
  type ChatItem,
  type PermissionChoice,
  type PromptImage,
  type ThreadStatus,
  type ThreadSummary,
  type ToolStatus,
} from "../shared/protocol.ts";
import { LAYOUT_CHECK } from "../shared/layout.ts";
import { ALTERNATIVE_LABELS, describeTarget, MAX_ALTERNATIVES } from "../shared/review.ts";
import {
  loadThreads,
  newThreadId,
  removeThreadFile,
  saveThread,
  saveThreadList,
  threadTitle,
  UNTITLED,
} from "./chatlog.ts";
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

/** Chat events name the thread they belong to after the item (or its id). */
type Events = {
  agent: [AgentState];
  chat: [ChatItem, string];
  "chat-remove": [string, string];
  threads: [ThreadSummary[]];
};
type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * One thread of the project: a conversation of its own in an agent session of its own, kept across restarts by
 * server/chatlog.ts. Every thread works in the same workspace, so their turns take turns (one queue for all).
 */
interface Thread {
  id: string;
  title: string;
  /** When a turn last started in it, or it was made. */
  at: number;
  transcript: ChatItem[];
  /** The agent session its conversation lives in; after a restart its next turn resumes it (openSession). */
  session?: { agent: AgentId; id: string };
  /** Its session was opened without the brief as system prompt, so the next turn sends the brief first. */
  needsPreamble: boolean;
  /** The linked repo its session was given as a working directory; a changed link reopens it (syncRepo). */
  sessionRepo?: string;
  openText?: { id: string; kind: "agent" | "thought" };
}

export interface PromptOptions {
  /** The thread the prompt goes to; the one shown last when absent or unknown. */
  thread?: string;
  /** With 2 or 3, that many takes on the prompt to choose between. */
  alternatives?: number;
}

/**
 * Runs one ACP agent as a subprocess and acts as its client: streams the
 * updates of each thread's session into that thread's transcript, serves file
 * reads/writes inside the workspace and routes permission requests to the
 * browser. One process holds the sessions of every thread of the project.
 */
export class AgentHost extends EventEmitter<Events> {
  private state: AgentState;
  /** Newest first; there is always at least one. */
  private threads: Thread[];
  /** The thread shown last, which a tab shows when it does not name one. */
  private active: string;
  private proc?: ChildProcess;
  private connection?: acp.ClientConnection;
  /** Sessions opened in the running agent; a thread's session not among them is resumed at its next turn. */
  private opened = new Set<string>();
  /** The thread whose turn runs, with its fix-ups or alternatives. */
  private running?: Thread;
  private supportsSystemPrompt = false;
  private supportsResume = false;
  private saveTimer?: NodeJS.Timeout;
  /** Threads whose conversation changed since the last save; the list is saved with them. */
  private dirty = new Set<Thread>();
  /** Saves one after another, so an older write never lands after a newer one. */
  private saving: Promise<void> = Promise.resolve();
  /** The thread list as last announced, so it goes out only when it changed. */
  private listed = "";
  private permissions = new Map<string, { thread: Thread; resolve: (optionId: string | null) => void }>();
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
  /** Prompts sent while a turn was running, in any thread, oldest first. */
  private queued: { id: string; thread: Thread; text: string; attachments: Attachments; alternatives: number }[] = [];
  /** Set by Stop; ends the current set of alternatives and the fix loop, not just the running turn. */
  private stopping = false;
  /** What to tell the user when the running agent's login fails (from its LaunchSpec). */
  private loginHint = "";
  /** View files whose screens the last check found wrong, checked again after the next fix-up turn. */
  private flaggedViews: string[] = [];

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
    const first = this.makeThread();
    this.threads = [first];
    this.active = first.id;
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

  /** True while a permission request waits for the user's answer, in any thread. */
  get waiting(): boolean {
    return this.permissions.size > 0;
  }

  /** The threads, newest first, with what each is up to. */
  get threadList(): ThreadSummary[] {
    return this.threads.map(({ id, title, at }) => {
      const status = this.threadStatus(id);
      return status ? { id, title, at, status } : { id, title, at };
    });
  }

  /** The thread shown last. */
  get activeThread(): string {
    return this.current.id;
  }

  /** A thread's conversation, or undefined for a thread there is not. */
  threadChat(id: string): ChatItem[] | undefined {
    return this.find(id)?.transcript;
  }

  /** Shows a thread: a tab that does not name one shows it from now on. Returns its conversation. */
  showThread(id: string): ChatItem[] | undefined {
    const thread = this.find(id);
    if (!thread) return undefined;
    this.active = thread.id;
    this.scheduleSave();
    return thread.transcript;
  }

  /**
   * Starts a thread, with a session of its own from its first turn on, and shows it. A thread nothing was asked in
   * yet is new enough, so that one moves to the top instead of another empty one.
   */
  newThread(): string {
    const empty = this.threads.find((thread) => thread.transcript.length === 0 && !this.threadStatus(thread.id));
    const thread = empty ?? this.makeThread();
    thread.at = Date.now();
    this.threads = [thread, ...this.threads.filter((other) => other !== thread)];
    this.active = thread.id;
    this.scheduleSave();
    this.announce();
    return thread.id;
  }

  /** Removes an idle thread and its conversation. False when it is the last one or has something under way. */
  removeThread(id: string): boolean {
    const thread = this.find(id);
    if (!thread || this.threads.length === 1 || this.threadStatus(id)) return false;
    this.threads = this.threads.filter((other) => other !== thread);
    this.dirty.delete(thread);
    if (this.active === id) this.active = this.threads[0]!.id;
    this.saving = this.saving
      .then(() => removeThreadFile(this.workspace.dir, id))
      .catch((error: Error) => console.error("[basis] could not remove the thread:", error.message));
    this.scheduleSave();
    this.announce();
    return true;
  }

  /** What a thread is up to: waiting for an answer, working, queued behind another turn, or nothing. */
  private threadStatus(id: string): ThreadStatus | undefined {
    if ([...this.permissions.values()].some((entry) => entry.thread.id === id)) return "waiting";
    if (this.running?.id === id) return "working";
    if (this.queued.some((item) => item.thread.id === id)) return "queued";
    return undefined;
  }

  private get current(): Thread {
    return this.find(this.active) ?? this.threads[0]!;
  }

  private find(id: string | undefined): Thread | undefined {
    return id === undefined ? undefined : this.threads.find((thread) => thread.id === id);
  }

  private makeThread(): Thread {
    return { id: newThreadId(), title: UNTITLED, at: Date.now(), transcript: [], needsPreamble: false };
  }

  /** The thread whose session this is, while that session is open. */
  private sessionThread(sessionId: string): Thread | undefined {
    if (!this.opened.has(sessionId)) return undefined;
    return this.threads.find((thread) => thread.session?.id === sessionId);
  }

  /** Tells whoever listens about the thread list when it changed (a title, a status, a thread made or removed). */
  private announce(): void {
    const list = this.threadList;
    const listed = JSON.stringify(list);
    if (listed === this.listed) return;
    this.listed = listed;
    this.emit("threads", list);
  }

  /**
   * Brings back the threads saved before the last restart (or the one conversation from before threads); each
   * resumes its session at its next turn, and the one shown last as the agent starts.
   */
  async restore(): Promise<void> {
    const saved = await loadThreads(this.workspace.dir);
    if (!saved.threads.length) return;
    this.threads = saved.threads.map(({ id, title, at, saved: chat }) => ({
      id,
      title,
      at,
      transcript: chat?.chat ?? [],
      session: chat?.sessionId ? { agent: chat.agent, id: chat.sessionId } : undefined,
      needsPreamble: false,
    }));
    this.active = saved.active;
    this.listed = "";
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
      this.opened.clear();
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
      // The thread shown last opens now, so Ready means a turn can start; the others open at their first turn.
      await this.openSession(this.current);
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
    this.opened.clear();
    if (proc?.pid && proc.exitCode === null) {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      else proc.kill();
    }
    this.setState({ ...this.state, status: "stopped", detail: undefined });
  }

  /**
   * Runs what the user sent in a thread: one turn, or with `alternatives` > 1
   * that many takes on it to choose between. A prompt sent while the agent
   * works, in this thread or another, is queued and runs when it is free again.
   */
  async prompt(text: string, attachments: Attachments = {}, options: PromptOptions = {}): Promise<void> {
    const thread = this.find(options.thread) ?? this.current;
    const count = Math.max(1, Math.min(MAX_ALTERNATIVES, Math.floor(options.alternatives ?? 1) || 1));
    await this.run(thread, text, attachments, count);
  }

  /** Runs a prompt in a thread, or queues it; `queuedId` is the chat item it was queued as. */
  private async run(
    thread: Thread,
    text: string,
    attachments: Attachments,
    count: number,
    queuedId?: string,
  ): Promise<void> {
    const connection = this.connection;
    if (!connection || (this.state.status !== "busy" && this.state.status !== "ready")) return;
    const annotations = attachments.annotations ?? [];
    const label = text || annotations.map(annotationLabel).join(", ") || "Image prompt";
    // A thread is named after what was first asked in it, queued or not.
    if (thread.title === UNTITLED && !thread.transcript.some((item) => item.kind === "user")) {
      thread.title = threadTitle(label);
    }
    if (this.state.status === "busy") return this.enqueue(thread, text, attachments, count);
    this.stopping = false;
    this.running = thread;
    thread.at = Date.now();
    const images = this.state.supportsImages ? acceptedImages(attachments.images) : [];
    this.setState({ ...this.state, status: "busy", detail: undefined });
    this.push(thread, {
      ...this.userItem(queuedId ?? this.nextId("user"), text, images, annotations, false),
      alternatives: count > 1 ? count : undefined,
    });
    const turn = { text, images, annotations, label, instruction: attachments.instruction };
    if (count > 1) await this.runAlternatives(thread, turn, count);
    else await this.runChecked(thread, turn);
    this.running = undefined;
    if (this.connection === connection) this.setState({ ...this.state, status: "ready" });
    else this.announce();
    // Whatever was queued meanwhile, in any thread, runs once everything above is done.
    await this.runQueued();
  }

  /** One turn plus the fix-up turns for what it left broken. Returns false when it was stopped or failed. */
  private async runChecked(thread: Thread, turn: Turn): Promise<boolean> {
    const connection = this.connection;
    this.flaggedViews = [];
    const completed = await this.runTurn(thread, turn);
    for (let fixes = 0; completed && fixes < MAX_AUTO_FIXES && !this.stopping; fixes += 1) {
      const problems = await this.collectProblems();
      if (!problems || this.connection !== connection) break;
      this.push(thread, this.userItem(this.nextId("user"), problems, [], [], true));
      // Fix-up turns are labelled as such in history and reviews, not with the whole problem report.
      await this.runTurn(thread, { text: problems, images: [], annotations: [], label: "Fixed reported problems" });
    }
    return completed && !this.stopping;
  }

  /**
   * Makes `count` takes on one prompt, each from the same starting point, for
   * the user to compare in a review and pick from. Between takes Basis puts the
   * workspace back; the agent's session remembers the earlier takes, so it can
   * make the next one different.
   */
  private async runAlternatives(thread: Thread, turn: Turn, count: number): Promise<void> {
    const labels = ALTERNATIVE_LABELS.slice(0, count);
    await this.workspace.beginAlternatives(turn.label, count);
    for (const [index, label] of labels.entries()) {
      if (index > 0) {
        if (!this.workspace.review?.alternatives || this.stopping || !this.connection) break;
        await this.workspace.nextAlternative();
      }
      this.notice(thread, `Alternative ${label} of ${count}`, "info");
      const completed = await this.runChecked(thread, {
        ...turn,
        label: `Alternative ${label}: ${turn.label}`,
        instruction: [turn.instruction, alternativeInstruction(index, labels, Boolean(this.workspace.review))]
          .filter(Boolean)
          .join("\n\n"),
      });
      if (!(await this.workspace.alternativeDone(label))) {
        if (index === 0)
          this.notice(
            thread,
            "The agent made one version without opening a review, so there is nothing to compare it with.",
            "info",
          );
        break;
      }
      if (!completed) break;
    }
    await this.workspace.endAlternatives();
  }

  /**
   * Sends one turn to the agent in the thread's session (opened or resumed first when it is not open) and records
   * what it changed as one undo step (or iteration).
   */
  private async runTurn(thread: Thread, turn: Turn): Promise<boolean> {
    const connection = this.connection;
    if (!connection) return false;
    let sessionId: string;
    try {
      sessionId = await this.openSession(thread);
    } catch (error) {
      if (this.connection === connection) this.notice(thread, describeError(error, this.loginHint), "error");
      return false;
    }
    await this.syncRepo(connection, thread, sessionId);
    await this.workspace.beginTurn(turn.label, thread.title);
    // Each turn, the fix-ups included, holds the preview on its own: the fix loop needs to see each one's result.
    this.preview?.hold();
    this.checksBefore = new Set([...this.checks, ...this.workspace.state.colorFindings]);
    const message = turn.text || "See the attached context.";
    const body = thread.needsPreamble
      ? `${FIRST_PROMPT_PREAMBLE}

${message}`
      : message;
    thread.needsPreamble = false;
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
      if (result.stopReason === "cancelled") this.notice(thread, "Stopped.", "info");
      else if (!completed) this.notice(thread, `The agent stopped early (${result.stopReason}).`, "error");
    } catch (error) {
      if (this.connection === connection) this.notice(thread, describeError(error, this.loginHint), "error");
    } finally {
      thread.openText = undefined;
      this.cancelPermissions();
    }
    // Stay busy while the turn is checked and recorded as one undo step; the preview shows the result either way.
    try {
      await this.workspace.endTurn();
    } finally {
      this.reloaded = this.preview?.release() ?? null;
    }
    return completed && this.connection === connection;
  }

  /** Removes a queued prompt before it runs. */
  unqueue(id: string): void {
    const item = this.queued.find((queued) => queued.id === id);
    if (!item) return;
    this.queued = this.queued.filter((queued) => queued !== item);
    this.remove(item.thread, id);
  }

  private enqueue(thread: Thread, text: string, attachments: Attachments, alternatives: number): void {
    const id = this.nextId("user");
    const images = this.state.supportsImages ? acceptedImages(attachments.images) : [];
    // In the queue before the item goes out, so the thread list says it is queued.
    this.queued.push({ id, thread, text, attachments, alternatives });
    this.push(thread, {
      ...this.userItem(id, text, images, attachments.annotations ?? [], false),
      queued: true,
      alternatives: alternatives > 1 ? alternatives : undefined,
    });
  }

  private async runQueued(): Promise<void> {
    const next = this.queued.shift();
    if (!next) return;
    // The message moves from where it was queued to the end of its conversation, where its turn starts.
    this.remove(next.thread, next.id);
    await this.run(next.thread, next.text, next.attachments, next.alternatives, next.id);
  }

  /** Drops the prompts queued in one thread. */
  private clearQueue(thread: Thread): void {
    for (const item of this.queued) if (item.thread === thread) this.remove(thread, item.id);
    this.queued = this.queued.filter((item) => item.thread !== thread);
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
    const remote = screens.filter((screen) => screen.kind === "remote").map((screen) => screen.text);
    if (remote.length) {
      sections.push(
        `These view screens load images from other sites, which can change, vanish or need a login before the implementation is compared with the design. Replace each with a placeholder in views/assets/ (a simple SVG you write), imported into the view and on an element marked data-basis-media, as "Views: whole screens" in AGENTS.md says:\n${list(remote)}`,
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

  /**
   * Stops the running turn; the prompts queued behind it in its thread are dropped too, since Stop means stop.
   * Prompts queued in other threads were sent about something else, so they run next.
   */
  async cancel(): Promise<void> {
    const thread = this.running;
    this.stopping = true;
    if (thread) this.clearQueue(thread);
    this.cancelPermissions();
    const sessionId = thread?.session?.id;
    if (this.connection && sessionId) {
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId });
    }
  }

  resolvePermission(id: string, optionId: string | null): void {
    this.permissions.get(id)?.resolve(optionId);
  }

  /**
   * Opens the thread's session in the running agent, unless it is open, and returns its id. It first tries to
   * resume the session the thread had, so the agent remembers the conversation the transcript shows; otherwise
   * (another agent, or resuming fails) it starts a new one.
   */
  private async openSession(thread: Thread): Promise<string> {
    const connection = this.connection;
    if (!connection) throw new Error("Agent is not connected");
    const saved = thread.session;
    if (saved && this.opened.has(saved.id)) return saved.id;
    const base = this.sessionBase(thread);
    if (saved && saved.agent === this.state.id && this.supportsResume) {
      try {
        const resumed = await connection.agent.request(acp.methods.agent.session.resume, {
          ...base,
          sessionId: saved.id,
          ...(this.supportsSystemPrompt ? { systemPrompt: SYSTEM_PROMPT } : {}),
        });
        await this.askingMode(connection, saved.id, (resumed as acp.ResumeSessionResponse | undefined)?.modes);
        this.opened.add(saved.id);
        thread.needsPreamble = false;
        return saved.id;
      } catch {
        // Falls through to a new session below.
      }
    }
    if (saved && thread.transcript.length > 0) {
      this.notice(
        thread,
        saved.agent === this.state.id
          ? "The agent starts a new conversation after the restart; the messages above are for reference."
          : `${AGENT_LABELS[this.state.id]} starts a new conversation in this chat; the messages above are for reference.`,
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
    const session = response ?? (await connection.agent.request(acp.methods.agent.session.new, base));
    if (!session?.sessionId) throw new Error("The agent did not return a session id");
    thread.needsPreamble = response === undefined;
    await this.askingMode(connection, session.sessionId, session.modes);
    thread.session = { agent: this.state.id, id: session.sessionId };
    this.opened.add(session.sessionId);
    this.scheduleSave(thread);
    return session.sessionId;
  }

  /** What every session is opened with; the thread remembers the repo it names. */
  private sessionBase(thread: Thread) {
    thread.sessionRepo = this.repo;
    return { cwd: this.workspace.dir, mcpServers: this.mcpServers, _meta: sessionMeta(this.repo) };
  }

  /**
   * Gives the open session the repo linked now, before a turn. Claude Code reads its working directories only when
   * its session starts; resuming the live session with different ones makes the adapter rebuild it from its
   * transcript, so the conversation goes on. Other agents are not given the repo this way (sessionMeta).
   */
  private async syncRepo(connection: acp.ClientConnection, thread: Thread, sessionId: string): Promise<void> {
    if (this.repo === thread.sessionRepo) return;
    const base = this.sessionBase(thread);
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

  /**
   * Saves the thread list, and the conversation of a thread that changed, shortly after; streamed text changes it
   * many times a second.
   */
  private scheduleSave(thread?: Thread): void {
    if (thread) this.dirty.add(thread);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const dirty = [...this.dirty];
      this.dirty.clear();
      const list = { active: this.current.id, threads: this.threads };
      const dir = this.workspace.dir;
      this.saving = this.saving
        .then(async () => {
          for (const changed of dirty) {
            if (!this.threads.includes(changed)) continue;
            const { session, transcript } = changed;
            await saveThread(dir, changed.id, {
              agent: session?.agent ?? this.state.id,
              sessionId: session?.id ?? null,
              chat: transcript,
            });
          }
          await saveThreadList(dir, list);
        })
        .catch((error: Error) => console.error("[basis] could not save the chat:", error.message));
    }, 400);
  }

  private onUpdate(params: acp.SessionNotification): void {
    const thread = this.sessionThread(params.sessionId);
    if (!thread) return;
    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (update.content.type !== "text") return;
        this.appendText(
          thread,
          update.sessionUpdate === "agent_message_chunk" ? "agent" : "thought",
          update.content.text,
        );
        return;
      }
      case "tool_call": {
        const tool = basisTool(update);
        if (tool) this.basisCalls.set(`tool-${update.toolCallId}`, tool);
        this.push(thread, {
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
        const existing = thread.transcript.find((item) => item.id === id);
        if (existing?.kind !== "tool") return;
        const tool = basisTool(update) ?? this.basisCalls.get(id);
        const title = tool
          ? update.rawInput !== undefined
            ? basisToolTitle(tool, update.rawInput)
            : existing.title
          : (update.title ?? existing.title);
        this.push(thread, {
          ...existing,
          title,
          toolKind: update.kind ?? existing.toolKind,
          status: (update.status as ToolStatus | null | undefined) ?? existing.status,
        });
        return;
      }
      case "plan": {
        const entries = update.entries.map((entry) => ({ content: entry.content, status: entry.status }));
        const last = thread.transcript.findLast((item) => item.kind === "plan" || item.kind === "user");
        const id = last?.kind === "plan" ? last.id : this.nextId("plan");
        this.push(thread, { kind: "plan", id, entries });
        return;
      }
      default:
        return;
    }
  }

  private async onPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const call = params.toolCall;
    const thread = this.sessionThread(params.sessionId) ?? this.running ?? this.current;
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
      this.notice(
        thread,
        `Basis refused an edit in the linked product repo (${inProduct}); the agent only reads it.`,
        "info",
      );
      const reject = options.find((option) => option.kind === "reject_once");
      return reject
        ? { outcome: { outcome: "selected", optionId: reject.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

    const id = this.nextId("permission");
    const title = call.title ?? "The agent wants to run a tool";
    const detail = describeRawInput(call.rawInput) ?? (paths.length ? paths.join("\n") : undefined);
    // Waiting before the item goes out, so whoever hears of it sees the agent waiting (see `waiting`).
    const answered = new Promise<string | null>((resolve) => this.permissions.set(id, { thread, resolve }));
    this.push(thread, { kind: "permission", id, title, detail, options });
    const optionId = await answered;
    this.permissions.delete(id);
    const chosen = options.find((option) => option.optionId === optionId);
    this.push(thread, { kind: "permission", id, title, detail, options, resolved: chosen?.name ?? "Cancelled" });
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

  private appendText(thread: Thread, kind: "agent" | "thought", chunk: string): void {
    const open = thread.openText;
    const current = open?.kind === kind ? thread.transcript.find((item) => item.id === open.id) : undefined;
    if (current && (current.kind === "agent" || current.kind === "thought")) {
      this.push(thread, { ...current, text: current.text + chunk }, true);
      return;
    }
    const id = this.nextId(kind);
    this.push(thread, { kind, id, text: chunk }, true);
    thread.openText = { id, kind };
  }

  /** Inserts or replaces an item in a thread's transcript and broadcasts it. */
  private push(thread: Thread, item: ChatItem, keepTextOpen = false): void {
    if (!keepTextOpen) thread.openText = undefined;
    const index = thread.transcript.findIndex((existing) => existing.id === item.id);
    if (index === -1) thread.transcript.push(item);
    else thread.transcript[index] = item;
    this.emit("chat", item, thread.id);
    this.scheduleSave(thread);
    this.announce();
  }

  private remove(thread: Thread, id: string): void {
    thread.transcript = thread.transcript.filter((item) => item.id !== id);
    this.emit("chat-remove", id, thread.id);
    this.scheduleSave(thread);
    this.announce();
  }

  private notice(thread: Thread, text: string, tone: "info" | "error"): void {
    this.push(thread, { kind: "notice", id: this.nextId("notice"), text, tone });
  }

  private fail(detail: string): void {
    this.cancelPermissions();
    void this.workspace.endTurn().then(() => this.preview?.release());
    this.setState({ ...this.state, status: "error", detail });
  }

  private cancelPermissions(): void {
    for (const { resolve } of this.permissions.values()) resolve(null);
    this.permissions.clear();
  }

  private setState(next: AgentState): void {
    this.state = next;
    this.emit("agent", next);
    this.announce();
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
