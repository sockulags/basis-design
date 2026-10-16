import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { AGENT_IDS, type AgentId, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { AgentHost } from "./agent.ts";
import { Workspace } from "./workspace.ts";

const root = path.resolve(import.meta.dirname, "..");
const production = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5320);
const workspaceDir = path.resolve(process.env.BASIS_WORKSPACE ?? path.join(root, "workspace"));
const initialAgent: AgentId = AGENT_IDS.includes(process.env.BASIS_AGENT as AgentId)
  ? (process.env.BASIS_AGENT as AgentId)
  : "claude";

const workspace = new Workspace(workspaceDir);
await workspace.init();
const agent = new AgentHost(workspace, initialAgent);

const server = http.createServer();

if (production) {
  const distDir = path.join(root, "dist");
  server.on("request", (req, res) => serveStatic(distDir, req, res));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  server.on("request", (req, res) => vite.middlewares(req, res));
}

// The bridge can drive an agent that edits files, so only this app's own pages may connect.
const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
// Prompts can carry a few images, so allow larger frames than chat text needs.
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/bridge") return; // Vite's HMR socket handles its own upgrades.
  if (!allowedOrigins.has(req.headers.origin ?? "")) {
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

workspace.on("design", (design) => broadcast({ type: "design", design }));
workspace.on("history", (history) => broadcast({ type: "history", history }));
agent.on("agent", (state) => broadcast({ type: "agent", agent: state }));
agent.on("chat", (item) => broadcast({ type: "chat-upsert", item }));
agent.on("chat-reset", () => broadcast({ type: "chat-reset" }));

sockets.on("connection", (ws: WebSocket) => {
  send(ws, {
    type: "hello",
    design: workspace.state,
    history: workspace.entries,
    agent: agent.agent,
    chat: agent.chat,
  });
  ws.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(data)) as ClientMessage;
    } catch {
      return;
    }
    void handle(message, ws).catch((error: unknown) => console.error("[basis]", error));
  });
});

async function handle(message: ClientMessage, socket: WebSocket): Promise<void> {
  switch (message.type) {
    case "prompt": {
      const text = message.text.trim();
      const hasAttachments = Boolean(message.images?.length || message.annotations?.length);
      if (text || hasAttachments) await agent.prompt(text, { images: message.images, annotations: message.annotations });
      return;
    }
    case "cancel":
      return agent.cancel();
    case "permission":
      return agent.resolvePermission(message.id, message.optionId);
    case "new-session":
      return agent.newSession();
    case "switch-agent":
      if (AGENT_IDS.includes(message.agent)) await agent.start(message.agent);
      return;
    case "revert":
      return workspace.revert(message.historyId);
    case "snapshot-get": {
      const design = await workspace.snapshotDesign(message.id);
      if (design) send(socket, { type: "snapshot", id: message.id, design });
      return;
    }
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(distDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://local");
  let file = path.join(distDir, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(distDir, "index.html");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

server.listen(port, host, () => {
  console.log(`Basis is running at http://localhost:${port}`);
  console.log(`Workspace: ${workspaceDir}`);
  void agent.start();
});

async function shutdown(): Promise<void> {
  workspace.close();
  await agent.stop();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
