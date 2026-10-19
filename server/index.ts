import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer as createVite } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { isComponentName, isPageId, pageById } from "../shared/frame.ts";
import { parseWidths, widthList } from "../shared/widths.ts";
import {
  AGENT_IDS,
  type AgentId,
  type ClientMessage,
  type ProjectEntry,
  type ServerMessage,
  type Tagged,
} from "../shared/protocol.ts";
import { handleToolRequest, toolSecret, toolServer, TOOLS_PATH, toolsUrl } from "./agent-tools.ts";
import { BACKGROUND_PATH, HOST_PAGE } from "./background.ts";
import { createInstruction, importInstruction, templateInstruction, viewInstruction } from "./brief.ts";
import { buildStarterKit, slug, writeStarterKit, zipStarterKit } from "./export.ts";
import { buildVerificationKit, writeVerificationKit, zipVerificationKit } from "./verify.ts";
import { OpenProjects } from "./open-projects.ts";
import { guard, isLocalHost, OpenProject, refuseHost, type ProjectOptions } from "./project.ts";
import { pickFolder, suggestRepos } from "./folders.ts";
import { checkRepo, Projects } from "./projects.ts";
import { templateChanges } from "./template.ts";

// History, reviews and restores all run on git; without it nothing below works, and the error would not say why.
if (spawnSync("git", ["--version"], { windowsHide: true }).error) {
  console.error("Basis needs git on the PATH. Install it from https://git-scm.com/downloads and start Basis again.");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5320);
const previewPort = Number(process.env.BASIS_PREVIEW_PORT ?? port + 1);
/**
 * Holds the project list and the folders of new projects: ~/.basis, never Basis' own folder, which an update or an
 * npx cache may replace.
 */
const home = path.resolve(process.env.BASIS_HOME ?? path.join(os.homedir(), ".basis"));
/** The agent a project starts with when it opens: BASIS_AGENT at first, then the one last picked in any project. */
let defaultAgent: AgentId = AGENT_IDS.includes(process.env.BASIS_AGENT as AgentId)
  ? (process.env.BASIS_AGENT as AgentId)
  : "claude";

const chromeOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
/** What the agent's MCP server for Basis' tools sends with every request (server/agent-tools.ts). */
const toolsSecret = toolSecret();

const projects = new Projects(home);
// Earlier versions kept their data in Basis' own folder: the project list there (whose projects stay where they
// are), and before projects a single workspace. A home of its own (BASIS_HOME, say a test instance's) never takes
// either over: it starts with a new project instead.
const legacy = process.env.BASIS_HOME ? undefined : root;
await projects.load({
  only: process.env.BASIS_WORKSPACE,
  legacyList: legacy && path.join(legacy, "basis.projects.json"),
  fallback: legacy && existsSync(path.join(legacy, "workspace")) ? path.join(legacy, "workspace") : undefined,
});
if (!projects.active) await projects.setActive((await projects.create("Basis")).id);

/** Bridge connections; created first, since the project reports events while it opens. */
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

/**
 * How a project opens: the first one open on PORT + 1 (or BASIS_PREVIEW_PORT), the others on free ports, since
 * ports in a row could run into another Basis. Its messages go to the tabs that show it, and its screenshot tool
 * names it.
 */
function projectOptions(entry: ProjectEntry, slot: number): ProjectOptions {
  return {
    root,
    host,
    previewPort: slot === 0 ? previewPort : 0,
    slot,
    chromeOrigins,
    agent: defaultAgent,
    home,
    mcpServers: [toolServer(toolsUrl(`http://${host}:${port}`, entry.id), toolsSecret)],
    broadcast: (message) => sendProject(entry.id, message),
  };
}

/** The projects open now: one in each tab, the rest working or idle in the background (server/open-projects.ts). */
const open = new OpenProjects<OpenProject, WebSocket>(
  async (entry, slot) => {
    const project = await OpenProject.open(entry, projectOptions(entry, slot));
    // Working, waiting for an answer, done: what the project menu shows of each project.
    project.agent.on("agent", () => open.update(entry.id));
    project.agent.on("chat", () => open.update(entry.id));
    return project;
  },
  { onStatus: (status) => broadcast({ type: "project-status", status }) },
);
/** A port in use is the start-up failure people meet most (often a Basis already running); say how to get past it. */
function exitIfPortInUse(error: unknown): void {
  const err = error as NodeJS.ErrnoException & { port?: number };
  if (err?.code !== "EADDRINUSE") return;
  console.error(
    `Port ${err.port ?? "?"} is in use, perhaps by a Basis that is already running. Stop it, or start this one with ` +
      "another PORT (the preview uses PORT + 1, or BASIS_PREVIEW_PORT).",
  );
  process.exit(1);
}

// The project shown last opens at start, so the first tab finds it ready.
await open.open(projects.active!).catch((error: unknown) => {
  exitIfPortInUse(error);
  console.error(`Could not open ${projects.active!.name}: ${(error as Error).message}`);
  process.exit(1);
});

/*
 * Two origins. The chrome (chat, history, controls) runs on `port` and is the
 * only page allowed on the bridge. Each open project's preview runs on a port
 * of its own (see OpenProject).
 */
const chromeServer = http.createServer();
const chromeVite = await createVite({
  root,
  appType: "spa",
  cacheDir: "node_modules/.vite/chrome",
  optimizeDeps: { entries: ["index.html"] },
  // Vite forwards browser console errors to the terminal when it thinks an agent runs it; for Basis that is noise.
  server: { middlewareMode: true, hmr: { server: chromeServer }, forwardConsole: false },
});
const chromeGuard = guard((url) => url === "/preview.html" || url === "/capture.html");
chromeServer.on("request", (req, res) => {
  if (!isLocalHost(req, port)) return refuseHost(res);
  if (req.method === "GET" && req.url?.split("?")[0] === "/export/starter-kit.zip") {
    // The tab names its project; without one, the project shown last.
    const id = new URL(req.url, "http://local").searchParams.get("project") ?? projects.active?.id ?? "";
    void sendStarterKitZip(res, open.get(id));
    return;
  }
  if (req.method === "GET" && req.url === "/export/verification-kit.zip") {
    sendVerificationZip(res);
    return;
  }
  // The host page of a project's gallery in the background (server/background.ts).
  if (req.method === "GET" && req.url?.split("?")[0] === BACKGROUND_PATH) {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    res.end(HOST_PAGE);
    return;
  }
  if (req.url?.startsWith("/api/")) {
    void handleApi(req, res);
    return;
  }
  if (req.url?.startsWith(`${TOOLS_PATH}/`)) {
    void handleToolRequest(req, res, toolsSecret, (project) => open.get(project)?.screenshots ?? null);
    return;
  }
  chromeGuard(req, res, () => chromeVite.middlewares(req, res));
});

/** True while a folder dialog is open: one at a time. */
let picking = false;

/**
 * Small requests the chrome makes and waits for: a folder from the system's dialog, repos to suggest. Only POSTs
 * from the chrome's own origin, so another web page can neither open dialogs on this computer nor read the answer.
 */
async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || !chromeOrigins.includes(req.headers.origin ?? "")) return reply(403, {});
  let body: { title?: string; start?: string };
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return reply(400, {});
  }
  if (req.url === "/api/pick-folder") {
    if (picking) return reply(409, { error: "A folder dialog is already open." });
    picking = true;
    try {
      return reply(200, { path: await pickFolder(body.title ?? "Choose a folder", body.start) });
    } catch (error) {
      return reply(200, { path: null, error: (error as Error).message });
    } finally {
      picking = false;
    }
  }
  if (req.url === "/api/repos") {
    return reply(200, { repos: await suggestRepos(undefined, [root, ...projects.list.map((entry) => entry.dir)]) });
  }
  reply(404, {});
}

async function starterKit(project: OpenProject) {
  return buildStarterKit(project.workspace.state.design, project.workspace.dir);
}

async function sendStarterKitZip(res: http.ServerResponse, project: OpenProject | undefined): Promise<void> {
  if (!project) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("That project is not open in Basis.");
    return;
  }
  try {
    const folder = slug(project.workspace.state.design.name);
    const zip = zipStarterKit(await starterKit(project), folder);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folder}.zip"`,
      "Content-Length": zip.byteLength,
      "Cache-Control": "no-store",
    });
    res.end(zip);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Could not build the starter kit: ${(error as Error).message}`);
  }
}

/** The last verification kit built as a zip, until it is downloaded or another is built. */
let verificationZip: { name: string; data: Uint8Array } | null = null;
/** True while a verification kit is being built: one at a time, whichever project it is for. */
let verifying = false;

function sendVerificationZip(res: http.ServerResponse): void {
  if (!verificationZip) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("No verification kit has been built. Build one from the Export dialog.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${verificationZip.name}"`,
    "Content-Length": verificationZip.data.byteLength,
    "Cache-Control": "no-store",
  });
  res.end(verificationZip.data);
}

/** Builds a project's verification kit, reporting progress to the tabs that show it. */
async function verificationKit(
  target: OpenProject,
  project: string | undefined,
  skill: boolean,
  socket: WebSocket,
): Promise<void> {
  if (verifying) {
    send(socket, { type: "verify-result", result: { ok: false, error: "A verification kit is already being built." } });
    return;
  }
  verifying = true;
  const id = target.entry.id;
  try {
    const { files, summary } = await buildVerificationKit({
      design: target.workspace.state.design,
      workspaceDir: target.workspace.dir,
      widths: widthList(target.widths),
      onProgress: (step, done, total) => sendProject(id, { type: "verify-progress", step, done, total }),
    });
    if (project === undefined) {
      verificationZip = {
        name: `${slug(target.workspace.state.design.name)}-verification-kit.zip`,
        data: zipVerificationKit(files),
      };
      sendProject(id, { type: "verify-result", result: { ok: true, summary } });
      return;
    }
    const written = await writeVerificationKit(files, project, { skill });
    sendProject(id, {
      type: "verify-result",
      result: written.ok
        ? { ok: true, summary, dir: written.dir, skill: written.skill }
        : { ok: false, error: written.error },
    });
  } catch (error) {
    sendProject(id, { type: "verify-result", result: { ok: false, error: (error as Error).message } });
  } finally {
    verifying = false;
  }
}

chromeServer.on("upgrade", (req, socket, head) => {
  if (req.url?.split("?")[0] !== "/bridge") return; // Vite's HMR socket handles its own upgrades.
  if (!chromeOrigins.includes(req.headers.origin ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit("connection", ws, req));
});

function send(ws: WebSocket, message: Tagged<ServerMessage>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/** Sends to every tab, whatever project it shows. */
function broadcast(message: ServerMessage): void {
  for (const ws of sockets.clients) send(ws, message);
}

/** Sends one project's message to the tabs that show it, tagged with the project. */
function sendProject(id: string, message: ServerMessage): void {
  for (const ws of open.viewers(id)) send(ws, { ...message, projectId: id });
}

/** The thread each tab shows, of the project it shows. */
const threadOf = new Map<WebSocket, string>();

/** Everything about a project for a tab, with the thread it asks for (when the project has it) or the one shown last. */
function hello(ws: WebSocket, project: OpenProject, wanted?: string | null): void {
  const thread = wanted && project.agent.threadChat(wanted) ? wanted : project.agent.activeThread;
  threadOf.set(ws, thread);
  send(ws, {
    type: "hello",
    projectId: project.entry.id,
    previewPort: project.previewPort,
    project: project.entry,
    projects: projects.list,
    design: project.workspace.state,
    history: project.workspace.entries,
    agent: project.agent.agent,
    threads: project.agent.threadList,
    thread,
    chat: project.agent.threadChat(thread) ?? [],
    review: project.workspace.review,
    previewWaiting: project.hold.waiting,
    status: open.statuses(),
    widths: project.widths,
  });
}

/** Shows one of a project's threads in a tab, with its chat; a new tab shows it from now on too. */
function showThread(ws: WebSocket, project: OpenProject, id: string): void {
  const chat = project.agent.showThread(id);
  if (!chat) return;
  threadOf.set(ws, id);
  send(ws, { type: "thread", projectId: project.entry.id, thread: id, chat });
}

/**
 * Shows `entry` in a tab, opening it unless it is open, at the thread `thread` when it has that one. The project the
 * tab showed goes on in the background, its agent included. If the new one fails to open, the tab stays where it
 * was and the error is shown.
 */
async function showIn(ws: WebSocket, entry: ProjectEntry, thread?: string | null): Promise<boolean> {
  const before = open.shownBy(ws);
  if (before?.entry.id === entry.id) return true;
  if (!open.get(entry.id)) send(ws, { type: "project-switching", project: entry });
  try {
    const project = await open.show(ws, entry);
    // The tab closed while the project opened.
    if (ws.readyState !== ws.OPEN) {
      open.hide(ws);
      return false;
    }
    // Its preview no longer speaks for the project it left.
    before?.forget(ws);
    await projects.setActive(entry.id);
    hello(ws, project, thread);
    return true;
  } catch (error) {
    send(ws, { type: "project-error", message: `Could not open ${entry.name}: ${(error as Error).message}` });
    if (before) hello(ws, before);
    return false;
  }
}

sockets.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  // A tab that reconnects names the project and thread it showed; a new one gets the ones shown last.
  const query = new URL(req.url ?? "/", "http://local").searchParams;
  const wanted = query.get("project");
  void showIn(ws, (wanted && projects.find(wanted)) || projects.active!, query.get("thread"));
  ws.on("message", (data) => {
    let message: Tagged<ClientMessage>;
    try {
      message = JSON.parse(String(data)) as Tagged<ClientMessage>;
    } catch {
      return;
    }
    void handle(message, ws).catch((error: unknown) => console.error("[basis]", error));
  });
  ws.on("close", () => {
    open.shownBy(ws)?.forget(ws);
    open.hide(ws);
    threadOf.delete(ws);
  });
});

async function handle(message: Tagged<ClientMessage>, socket: WebSocket): Promise<void> {
  // Requests about the list of projects, whichever one the tab shows.
  switch (message.type) {
    case "project-switch": {
      const entry = projects.find(String(message.id ?? ""));
      if (entry) await showIn(socket, entry);
      return;
    }
    case "project-open": {
      let entry: ProjectEntry;
      try {
        entry = await projects.open(String(message.dir ?? ""));
      } catch (error) {
        send(socket, { type: "project-error", message: (error as Error).message });
        return;
      }
      broadcast({ type: "projects", projects: projects.list });
      await showIn(socket, entry);
      return;
    }
    case "project-remove": {
      const id = String(message.id ?? "");
      const target = open.get(id);
      if (target && (open.viewers(id).length || target.busy || target.waiting)) {
        send(socket, {
          type: "project-error",
          message: `${target.entry.name} is open or working; it stays on the list.`,
        });
        return;
      }
      await open.close(id);
      await projects.remove(id);
      broadcast({ type: "projects", projects: projects.list });
      return;
    }
    case "project-repo": {
      let entry: ProjectEntry;
      try {
        entry = await projects.setRepo(
          String(message.id ?? ""),
          typeof message.repo === "string" ? message.repo : null,
        );
      } catch (error) {
        send(socket, { type: "project-error", message: (error as Error).message });
        return;
      }
      const target = open.get(entry.id);
      target?.update(entry);
      broadcast({ type: "projects", projects: projects.list });
      if (message.bringIn === true && target) await bringInDesign(target, socket, message.thread);
      return;
    }
  }

  // Everything else belongs to one project: the one the tab showed when it sent the message, which may since
  // have gone to the background. A project that has closed meanwhile takes nothing.
  const project = message.projectId === undefined ? open.shownBy(socket) : open.get(String(message.projectId));
  if (!project) return;
  const { workspace, agent } = project;
  switch (message.type) {
    case "prompt": {
      const text = message.text.trim();
      const hasAttachments = Boolean(message.images?.length || message.annotations?.length);
      if (text || hasAttachments)
        await agent.prompt(
          text,
          { images: message.images, annotations: message.annotations },
          { thread: message.thread, alternatives: Number(message.alternatives) || 1 },
        );
      return;
    }
    case "create": {
      const name = String(message.name ?? "").trim();
      if (!isPageId(message.page) || !isComponentName(name)) return;
      const page = pageById(message.page);
      // A view's description is often a whole ticket, so it may run longer.
      const purpose = String(message.purpose ?? "")
        .trim()
        .slice(0, page.kind === "view" ? 8000 : 2000);
      const text = `New ${page.kind}: ${name}${purpose ? `\n\n${purpose}` : ""}`;
      const instruction =
        page.kind === "view"
          ? viewInstruction(page.folder, name, purpose)
          : createInstruction(page.kind, page.folder, name, purpose);
      await agent.prompt(text, { instruction }, { thread: message.thread });
      return;
    }
    case "cancel":
      return agent.cancel();
    case "permission":
      return agent.resolvePermission(message.id, message.optionId);
    case "thread-new":
      return showThread(socket, project, agent.newThread());
    case "thread-open":
      return showThread(socket, project, String(message.id ?? ""));
    case "thread-remove": {
      // Not one a tab shows: that tab would be left on a thread there is not.
      const id = String(message.id ?? "");
      const shown = [...threadOf].some(([ws, thread]) => thread === id && open.shownBy(ws) === project);
      if (!shown) agent.removeThread(id);
      return;
    }
    case "switch-agent":
      if (AGENT_IDS.includes(message.agent)) {
        defaultAgent = message.agent;
        await agent.start(message.agent);
      }
      return;
    case "revert":
      return workspace.revert(message.historyId);
    case "review-approve": {
      // Approving takes the review as it is: not mid-turn, not with known problems in it, and not before an
      // alternative is chosen.
      const { errors, typeErrors } = workspace.state;
      if (agent.agent.status === "busy" || errors || typeErrors || workspace.review?.alternatives) return;
      return workspace.approveReview();
    }
    case "review-discard":
      if (agent.agent.status === "busy") await agent.cancel();
      return workspace.discardReview();
    case "review-step":
      if (agent.agent.status === "busy") return;
      return workspace.reviewStep(String(message.id ?? ""));
    case "review-choose":
      if (agent.agent.status === "busy") return;
      return workspace.chooseAlternative(String(message.label ?? ""));
    case "unqueue":
      return agent.unqueue(String(message.id ?? ""));
    case "baseline-get": {
      const baseline = await workspace.baseline(String(message.id ?? ""));
      if (baseline)
        send(socket, {
          type: "baseline",
          projectId: project.entry.id,
          baseline: { id: baseline.id, design: baseline.design, base: project.previewPath(baseline.dir) },
        });
      return;
    }
    case "snapshot-get": {
      const snapshot = await workspace.snapshot(message.id);
      if (snapshot) send(socket, { type: "snapshot", projectId: project.entry.id, snapshot });
      return;
    }
    case "preview-errors":
      // Only from the project the tab shows: the gallery of one it left may still report on its way out.
      if (!Array.isArray(message.errors) || open.shownBy(socket) !== project) return;
      project.report(
        socket,
        message.errors,
        message.visible === true,
        Array.isArray(message.checks) ? message.checks : [],
        message.checking === true,
        Number.isSafeInteger(message.generation) ? Number(message.generation) : 0,
      );
      return;
    case "widths-set": {
      // Checked here too: the chrome only passes on what the control next to Show at sends.
      const widths = message.widths === null ? null : parseWidths(message.widths);
      if (widths || message.widths === null) await project.setWidths(widths);
      return;
    }
    case "export-manifest": {
      const files = await starterKit(project);
      send(socket, {
        type: "export-manifest",
        projectId: project.entry.id,
        folder: slug(workspace.state.design.name),
        files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })),
      });
      return;
    }
    case "export-write": {
      const result = await writeStarterKit(
        await starterKit(project),
        String(message.target ?? ""),
        message.overwrite === true,
      );
      send(socket, { type: "export-result", projectId: project.entry.id, result });
      return;
    }
    case "verify-kit":
      await verificationKit(
        project,
        typeof message.project === "string" ? message.project : undefined,
        message.skill === true,
        socket,
      );
      return;
    case "project-create": {
      const name = String(message.name ?? "").trim();
      const repoInput = typeof message.repo === "string" ? message.repo.trim() : "";
      if (!name && !repoInput) return;
      const copy = message.copyCurrent === true && !repoInput;
      // A copy taken mid-turn could hold half-written files.
      if (copy && project.busy) {
        send(socket, { type: "project-error", message: "The agent is working. Copy the project when it is done." });
        return;
      }
      let entry: ProjectEntry;
      try {
        // A repo is checked before anything is created, so a typo leaves no half-made project behind.
        const repo = repoInput ? await checkRepo(repoInput) : undefined;
        entry = await projects.create(name || path.basename(repo!), copy ? project.entry : undefined);
        if (repo) entry = await projects.setRepo(entry.id, repo);
      } catch (error) {
        send(socket, { type: "project-error", message: (error as Error).message });
        return;
      }
      broadcast({ type: "projects", projects: projects.list });
      if (!(await showIn(socket, entry))) return;
      // Starting from a repo means bringing in its design system, once the new project's agent is up.
      const created = open.get(entry.id);
      if (entry.repo && created && (await created.agent.whenReady())) await bringInDesign(created, socket);
      return;
    }
    case "import-design":
      return bringInDesign(project, socket, message.thread);
    case "template-update":
      return bringInTemplate(project, message.thread);
    case "template-skip":
      return workspace.settleTemplateUpdate();
  }
}

/**
 * Starts (or queues) the guided turn that brings a newer starter template's changes into the workspace's changed
 * starter files. The workspace counts as caught up once the turn has run (or is queued); its review shows what came
 * in.
 */
async function bringInTemplate(project: OpenProject, thread?: string): Promise<void> {
  const update = project.workspace.templateUpdate;
  if (!update) return;
  const instruction = templateInstruction(await templateChanges(update.from), update.files);
  await project.agent.prompt("Bring in the improvements to Basis' starter template", { instruction }, { thread });
  await project.workspace.settleTemplateUpdate();
}

/**
 * Starts (or queues, while the agent works) the guided turn that brings in the linked repo's design system, in the
 * thread the tab shows (or the one shown last).
 */
async function bringInDesign(project: OpenProject, socket: WebSocket, thread?: string): Promise<void> {
  const repo = project.entry.repo;
  if (!repo) {
    send(socket, { type: "project-error", message: "Link a product repo first." });
    return;
  }
  await project.agent.prompt(
    `Bring in the design system from ${path.basename(repo)}`,
    { instruction: importInstruction(repo) },
    { thread },
  );
}

chromeServer.once("error", (error) => {
  exitIfPortInUse(error);
  throw error;
});
chromeServer.listen(port, host, () => {
  console.log(`Basis is running at http://localhost:${port}`);
  console.log(`Project: ${projects.active!.name} (${projects.active!.dir})`);
});

async function shutdown(): Promise<void> {
  await open.closeAll();
  await chromeVite.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
