import http from "node:http";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { createServer as createVite, type Connect, type ViteDevServer } from "vite";
import { SOURCE_FOLDERS } from "../shared/frame.ts";
import type { AgentId, ProjectEntry, ServerMessage } from "../shared/protocol.ts";
import { AgentHost } from "./agent.ts";
import { rebasePlugin } from "./rebase.ts";
import { Screenshots } from "./screenshots.ts";
import { Workspace } from "./workspace.ts";

export interface ProjectOptions {
  /** Where Basis is installed: Vite's root for the preview. */
  root: string;
  host: string;
  previewPort: number;
  /** Origins allowed to frame the preview (the chrome). */
  chromeOrigins: string[];
  agent: AgentId;
  /** Basis' own folder (BASIS_HOME), for what the agent keeps outside the workspace (Codex's home for Basis). */
  home: string;
  /** MCP servers every agent session gets (Basis' own tools). */
  mcpServers: acp.McpServer[];
  /** Receives everything the project's workspace and agent report, for the bridge to broadcast. */
  broadcast: (message: ServerMessage) => void;
}

/**
 * True when a request names Basis' own host and port. A web page that points its own name at 127.0.0.1 (DNS
 * rebinding) sends its name instead, so it cannot read Basis' pages or the starter kit.
 */
export function isLocalHost(req: http.IncomingMessage, port: number): boolean {
  return req.headers.host === `localhost:${port}` || req.headers.host === `127.0.0.1:${port}`;
}

/** Answers 403 to requests for another host (see isLocalHost). */
export function refuseHost(res: http.ServerResponse): void {
  res.writeHead(403, { "Content-Type": "text/plain" });
  res.end("Basis only answers on localhost.");
}

/** Answers 404 for page entries that do not belong on this origin; everything else falls through. */
export function guard(blocked: (url: string) => boolean): Connect.NextHandleFunction {
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

/**
 * An open project: its workspace, its agent, and the preview server that
 * compiles its components. Only one project is open at a time; switching
 * closes this one and opens the next, on the same preview port.
 */
export class OpenProject {
  private constructor(
    private current: ProjectEntry,
    readonly workspace: Workspace,
    readonly agent: AgentHost,
    private readonly root: string,
    private readonly previewServer: http.Server,
    private readonly previewVite: ViteDevServer,
    /** Screenshots of specimens and view screens from this project's preview (server/screenshots.ts). */
    readonly screenshots: Screenshots,
  ) {}

  static async open(entry: ProjectEntry, options: ProjectOptions): Promise<OpenProject> {
    const { root, broadcast } = options;
    const workspace = new Workspace(entry.dir);
    await workspace.init();
    const agent = new AgentHost(workspace, options.agent, entry.repo, options.mcpServers, options.home);
    await agent.restore();

    workspace.on("design", (design) => broadcast({ type: "design", design }));
    workspace.on("history", (history) => broadcast({ type: "history", history }));
    workspace.on("review", (review) => broadcast({ type: "review", review }));
    agent.on("agent", (state) => broadcast({ type: "agent", agent: state }));
    agent.on("chat", (item) => broadcast({ type: "chat-upsert", item }));
    agent.on("chat-reset", () => broadcast({ type: "chat-reset" }));
    agent.on("chat-remove", (id) => broadcast({ type: "chat-remove", id }));

    /*
     * The preview runs on its own port inside a sandboxed iframe, because it
     * executes component code the agent writes; a different port is a
     * different origin, so that code cannot reach the bridge or the chrome.
     */
    const previewServer = http.createServer();
    const previewVite = await createVite({
      root,
      appType: "mpa",
      cacheDir: "node_modules/.vite/preview",
      optimizeDeps: { entries: ["preview.html", "capture.html"] },
      plugins: [rebasePlugin(root, entry.dir)],
      resolve: {
        alias: {
          "@ds": path.join(entry.dir, "components", "index.ts"),
          // The workspace itself, for discovering *.specimen.tsx files in its source folders.
          "@workspace": entry.dir,
        },
        // Workspace files may live outside this repo; React must still resolve to one copy.
        dedupe: ["react", "react-dom"],
      },
      server: {
        middlewareMode: true,
        // Agent-written code logs in the preview; its console belongs in the browser, not in the terminal.
        forwardConsole: false,
        hmr: { server: previewServer },
        fs: { allow: [root, entry.dir] },
        // 'self': the preview embeds a copy of itself for the accessibility check in the other theme.
        headers: { "Content-Security-Policy": `frame-ancestors 'self' ${options.chromeOrigins.join(" ")}` },
      },
    });
    // New specimen files must be noticed even when the workspace lives outside this repo.
    previewVite.watcher.add(SOURCE_FOLDERS.map((folder) => path.join(entry.dir, folder)));
    const previewGuard = guard((url) => url === "/" || url === "/index.html");
    previewServer.on("request", (req, res) => {
      if (!isLocalHost(req, options.previewPort)) return refuseHost(res);
      // The capture page (capture.html) reads the current tokens from here, as the kit's copy reads its own file.
      if (req.method === "GET" && req.url?.split("?")[0] === "/design.json") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(workspace.state.design));
        return;
      }
      previewGuard(req, res, () => previewVite.middlewares(req, res));
    });
    await new Promise<void>((resolve, reject) => {
      previewServer.once("error", reject);
      previewServer.listen(options.previewPort, options.host, resolve);
    });

    const screenshots = new Screenshots(`http://${options.host}:${options.previewPort}/capture.html`);
    void agent.start();
    return new OpenProject(entry, workspace, agent, root, previewServer, previewVite, screenshots);
  }

  get entry(): ProjectEntry {
    return this.current;
  }

  /** Takes a changed list entry for this project (say, a product repo linked); the agent reads it from its next turn. */
  update(entry: ProjectEntry): void {
    this.current = entry;
    this.agent.setRepo(entry.repo);
  }

  /** The URL path under which the preview serves a file or folder on disk. */
  previewPath(target: string): string {
    const relative = path.relative(this.root, target);
    const posix = (value: string) => value.split(path.sep).join("/");
    return relative.startsWith("..") || path.isAbsolute(relative) ? `/@fs/${posix(target)}` : `/${posix(relative)}`;
  }

  /** Stops the agent, the file watching and the preview server, and frees the preview port. */
  async close(): Promise<void> {
    this.workspace.removeAllListeners();
    this.agent.removeAllListeners();
    await this.agent.stop();
    await this.screenshots.close();
    await this.workspace.close();
    await this.previewVite.close();
    this.previewServer.closeAllConnections();
    await new Promise<void>((resolve) => this.previewServer.close(() => resolve()));
  }
}
