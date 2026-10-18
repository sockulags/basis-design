import http from "node:http";
import path from "node:path";
import { createServer as createVite } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { isComponentName, isPageId, pageById } from "../shared/frame.ts";
import {
  AGENT_IDS,
  type AgentId,
  type ClientMessage,
  type ProjectEntry,
  type ServerMessage,
} from "../shared/protocol.ts";
import { createInstruction, importInstruction } from "./brief.ts";
import { buildStarterKit, slug, writeStarterKit, zipStarterKit } from "./export.ts";
import { PreviewReports } from "./previews.ts";
import { guard, OpenProject, type ProjectOptions } from "./project.ts";
import { checkRepo, Projects } from "./projects.ts";

const root = path.resolve(import.meta.dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5320);
const previewPort = Number(process.env.BASIS_PREVIEW_PORT ?? port + 1);
/** Holds the project list and the folders of new projects. */
const home = path.resolve(process.env.BASIS_HOME ?? root);
const initialAgent: AgentId = AGENT_IDS.includes(process.env.BASIS_AGENT as AgentId)
  ? (process.env.BASIS_AGENT as AgentId)
  : "claude";

const chromeOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];

const projects = new Projects(home);
await projects.load({
  only: process.env.BASIS_WORKSPACE,
  // Basis kept a single workspace here before it had projects. A home of its own (BASIS_HOME, say a test
  // instance's) never takes it over: it starts with a new project instead.
  fallback: process.env.BASIS_HOME ? undefined : path.join(root, "workspace"),
});
if (!projects.active) await projects.setActive((await projects.create("Basis")).id);

/** Bridge connections; created first, since the project reports events while it opens. */
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
/** Render problems per open tab; the fix loop gets the current tab's (see PreviewReports). */
const previewReports = new PreviewReports<WebSocket>();
const projectOptions: ProjectOptions = {
  root,
  host,
  previewPort,
  chromeOrigins,
  agent: initialAgent,
  broadcast: (message) => broadcast(message),
};
let current = await OpenProject.open(projects.active!, projectOptions);
/** True while one project closes and the next opens; requests wait for the new hello. */
let switching = false;

/*
 * Two origins. The chrome (chat, history, controls) runs on `port` and is the
 * only page allowed on the bridge. The preview of the open project runs on
 * `previewPort` (see OpenProject).
 */
const chromeServer = http.createServer();
const chromeVite = await createVite({
  root,
  appType: "spa",
  cacheDir: "node_modules/.vite/chrome",
  optimizeDeps: { entries: ["index.html"] },
  server: { middlewareMode: true, hmr: { server: chromeServer } },
});
const chromeGuard = guard((url) => url === "/preview.html");
chromeServer.on("request", (req, res) => {
  if (req.method === "GET" && req.url === "/export/starter-kit.zip") {
    void sendStarterKitZip(res);
    return;
  }
  chromeGuard(req, res, () => chromeVite.middlewares(req, res));
});

async function starterKit() {
  return buildStarterKit(current.workspace.state.design, current.workspace.dir);
}

async function sendStarterKitZip(res: http.ServerResponse): Promise<void> {
  try {
    const folder = slug(current.workspace.state.design.name);
    const zip = zipStarterKit(await starterKit(), folder);
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

chromeServer.on("upgrade", (req, socket, head) => {
  if (req.url !== "/bridge") return; // Vite's HMR socket handles its own upgrades.
  if (!chromeOrigins.includes(req.headers.origin ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit("connection", ws, req));
});

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  for (const ws of sockets.clients) send(ws, message);
}

function hello(ws: WebSocket): void {
  send(ws, {
    type: "hello",
    previewPort,
    project: current.entry,
    projects: projects.list,
    design: current.workspace.state,
    history: current.workspace.entries,
    agent: current.agent.agent,
    chat: current.agent.chat,
    review: current.workspace.review,
  });
}

/**
 * Closes the open project and opens `entry`. Not while the agent works. If the
 * new one fails to open, the previous one opens again and the error is shown.
 */
async function switchTo(entry: ProjectEntry, socket: WebSocket): Promise<void> {
  if (switching || entry.id === current.entry.id) return;
  if (current.agent.agent.status === "busy") {
    send(socket, { type: "project-error", message: "The agent is working. Switch projects when it is done." });
    return;
  }
  switching = true;
  const previous = current.entry;
  broadcast({ type: "project-switching", project: entry });
  try {
    await current.close();
    try {
      current = await OpenProject.open(entry, projectOptions);
      await projects.setActive(entry.id);
    } catch (error) {
      send(socket, { type: "project-error", message: `Could not open ${entry.name}: ${(error as Error).message}` });
      current = await OpenProject.open(previous, projectOptions);
    }
  } finally {
    switching = false;
    for (const ws of sockets.clients) hello(ws);
  }
}

sockets.on("connection", (ws: WebSocket) => {
  if (!switching) hello(ws);
  ws.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(data)) as ClientMessage;
    } catch {
      return;
    }
    void handle(message, ws).catch((error: unknown) => console.error("[basis]", error));
  });
  ws.on("close", () => {
    previewReports.forget(ws);
    current.agent.setPreviewErrors(previewReports.current, previewReports.checks, previewReports.checking);
  });
});

async function handle(message: ClientMessage, socket: WebSocket): Promise<void> {
  // Everything below belongs to one project; while switching, the new hello tells clients what is open.
  if (switching) return;
  const { workspace, agent } = current;
  switch (message.type) {
    case "prompt": {
      const text = message.text.trim();
      const hasAttachments = Boolean(message.images?.length || message.annotations?.length);
      if (text || hasAttachments)
        await agent.prompt(
          text,
          { images: message.images, annotations: message.annotations },
          undefined,
          Number(message.alternatives) || 1,
        );
      return;
    }
    case "create": {
      const name = String(message.name ?? "").trim();
      const purpose = String(message.purpose ?? "")
        .trim()
        .slice(0, 2000);
      if (!isPageId(message.page) || !isComponentName(name)) return;
      const page = pageById(message.page);
      // New view gets its own guided turn in the next roadmap step.
      if (page.kind === "view") return;
      const text = `New ${page.kind}: ${name}${purpose ? `\n\n${purpose}` : ""}`;
      await agent.prompt(text, { instruction: createInstruction(page.kind, page.folder, name, purpose) });
      return;
    }
    case "cancel":
      return agent.cancel();
    case "permission":
      return agent.resolvePermission(message.id, message.optionId);
    case "new-session":
      return agent.newSession();
    case "switch-agent":
      if (AGENT_IDS.includes(message.agent)) {
        projectOptions.agent = message.agent;
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
          baseline: { id: baseline.id, design: baseline.design, base: current.previewPath(baseline.dir) },
        });
      return;
    }
    case "snapshot-get": {
      const snapshot = await workspace.snapshot(message.id);
      if (snapshot) send(socket, { type: "snapshot", snapshot });
      return;
    }
    case "preview-errors":
      if (!Array.isArray(message.errors)) return;
      previewReports.report(
        socket,
        message.errors,
        message.visible === true,
        Array.isArray(message.checks) ? message.checks : [],
        message.checking === true,
      );
      agent.setPreviewErrors(previewReports.current, previewReports.checks, previewReports.checking);
      return;
    case "export-manifest": {
      const files = await starterKit();
      send(socket, {
        type: "export-manifest",
        folder: slug(workspace.state.design.name),
        files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })),
      });
      return;
    }
    case "export-write": {
      const result = await writeStarterKit(
        await starterKit(),
        String(message.target ?? ""),
        message.overwrite === true,
      );
      send(socket, { type: "export-result", result });
      return;
    }
    case "project-switch": {
      const entry = projects.find(String(message.id ?? ""));
      if (entry) await switchTo(entry, socket);
      return;
    }
    case "project-create": {
      const name = String(message.name ?? "").trim();
      const repoInput = typeof message.repo === "string" ? message.repo.trim() : "";
      if (!name && !repoInput) return;
      if (agent.agent.status === "busy") {
        send(socket, { type: "project-error", message: "The agent is working. Create the project when it is done." });
        return;
      }
      let entry: ProjectEntry;
      try {
        // A repo is checked before anything is created, so a typo leaves no half-made project behind.
        const repo = repoInput ? await checkRepo(repoInput) : undefined;
        entry = await projects.create(
          name || path.basename(repo!),
          message.copyCurrent === true && !repo ? current.entry : undefined,
        );
        if (repo) entry = await projects.setRepo(entry.id, repo);
      } catch (error) {
        send(socket, { type: "project-error", message: (error as Error).message });
        return;
      }
      broadcast({ type: "projects", projects: projects.list });
      await switchTo(entry, socket);
      // Starting from a repo means bringing in its design system, once the new project's agent is up.
      if (entry.repo && current.entry.id === entry.id && (await current.agent.whenReady())) await bringInDesign(socket);
      return;
    }
    case "project-open": {
      if (agent.agent.status === "busy") {
        send(socket, { type: "project-error", message: "The agent is working. Open the folder when it is done." });
        return;
      }
      let entry: ProjectEntry;
      try {
        entry = await projects.open(String(message.dir ?? ""));
      } catch (error) {
        send(socket, { type: "project-error", message: (error as Error).message });
        return;
      }
      broadcast({ type: "projects", projects: projects.list });
      return switchTo(entry, socket);
    }
    case "project-remove":
      await projects.remove(String(message.id ?? ""));
      broadcast({ type: "projects", projects: projects.list });
      return;
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
      if (entry.id === current.entry.id) current.update(entry);
      broadcast({ type: "projects", projects: projects.list });
      if (message.bringIn === true && entry.id === current.entry.id) await bringInDesign(socket);
      return;
    }
    case "import-design":
      return bringInDesign(socket);
  }
}

/** Starts (or queues, while the agent works) the guided turn that brings in the linked repo's design system. */
async function bringInDesign(socket: WebSocket): Promise<void> {
  const repo = current.entry.repo;
  if (!repo) {
    send(socket, { type: "project-error", message: "Link a product repo first." });
    return;
  }
  await current.agent.prompt(`Bring in the design system from ${path.basename(repo)}`, {
    instruction: importInstruction(repo),
  });
}

chromeServer.listen(port, host, () => {
  console.log(`Basis is running at http://localhost:${port}`);
  console.log(`Project: ${current.entry.name} (${current.entry.dir})`);
});

async function shutdown(): Promise<void> {
  await current.close();
  await chromeVite.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
