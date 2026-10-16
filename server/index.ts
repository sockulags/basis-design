import http from "node:http";
import path from "node:path";
import { createServer as createVite, type Connect } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { AGENT_IDS, type AgentId, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { AgentHost } from "./agent.ts";
import { Workspace } from "./workspace.ts";

const root = path.resolve(import.meta.dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5320);
const previewPort = Number(process.env.BASIS_PREVIEW_PORT ?? port + 1);
const workspaceDir = path.resolve(process.env.BASIS_WORKSPACE ?? path.join(root, "workspace"));
const initialAgent: AgentId = AGENT_IDS.includes(process.env.BASIS_AGENT as AgentId)
  ? (process.env.BASIS_AGENT as AgentId)
  : "claude";

const chromeOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];

const workspace = new Workspace(workspaceDir);
await workspace.init();
const agent = new AgentHost(workspace, initialAgent);

/** Answers 404 for page entries that do not belong on this origin; everything else falls through to Vite. */
function guard(blocked: (url: string) => boolean): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://local").pathname;
    if (blocked(url)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    next();
  };
}

/*
 * Two origins. The chrome (chat, history, controls) runs on `port` and is the
 * only page allowed on the bridge. The preview runs on `previewPort` inside a
 * sandboxed iframe, because it executes component code the agent writes; a
 * different port is a different origin, so that code cannot reach the bridge
 * or the chrome's DOM.
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
chromeServer.on("request", (req, res) => chromeGuard(req, res, () => chromeVite.middlewares(req, res)));

const previewServer = http.createServer();
const previewVite = await createVite({
  root,
  appType: "mpa",
  cacheDir: "node_modules/.vite/preview",
  optimizeDeps: { entries: ["preview.html"] },
  resolve: {
    alias: { "@ds": path.join(workspaceDir, "components", "index.ts") },
    // Workspace files may live outside this repo; React must still resolve to one copy.
    dedupe: ["react", "react-dom"],
  },
  server: {
    middlewareMode: true,
    hmr: { server: previewServer },
    fs: { allow: [root, workspaceDir] },
    headers: { "Content-Security-Policy": `frame-ancestors ${chromeOrigins.join(" ")}` },
  },
});
const previewGuard = guard((url) => url === "/" || url === "/index.html");
previewServer.on("request", (req, res) => previewGuard(req, res, () => previewVite.middlewares(req, res)));

const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
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

workspace.on("design", (design) => broadcast({ type: "design", design }));
workspace.on("history", (history) => broadcast({ type: "history", history }));
agent.on("agent", (state) => broadcast({ type: "agent", agent: state }));
agent.on("chat", (item) => broadcast({ type: "chat-upsert", item }));
agent.on("chat-reset", () => broadcast({ type: "chat-reset" }));

sockets.on("connection", (ws: WebSocket) => {
  send(ws, {
    type: "hello",
    previewPort,
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
      const snapshot = await workspace.snapshot(message.id);
      if (snapshot) send(socket, { type: "snapshot", snapshot });
      return;
    }
    case "preview-errors":
      if (Array.isArray(message.errors)) agent.setPreviewErrors(message.errors);
      return;
  }
}

chromeServer.listen(port, host, () => {
  previewServer.listen(previewPort, host, () => {
    console.log(`Basis is running at http://localhost:${port}`);
    console.log(`Workspace: ${workspaceDir}`);
    void agent.start();
  });
});

async function shutdown(): Promise<void> {
  workspace.close();
  await agent.stop();
  await Promise.all([chromeVite.close(), previewVite.close()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
