import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import type * as acp from "@agentclientprotocol/sdk";
import { createServer as createVite, type Connect, type ViteDevServer } from "vite";
import { SOURCE_FOLDERS } from "../shared/frame.ts";
import type { AgentId, ProjectEntry, ServerMessage } from "../shared/protocol.ts";
import { widthList, type Widths } from "../shared/widths.ts";
import { AgentHost } from "./agent.ts";
import { BackgroundPreview, pageForFiles } from "./background.ts";
import { hasAccess, isAllowedHost, refuseAccess, type Network } from "./network.ts";
import { PreviewHold } from "./hold.ts";
import { PreviewReports } from "./previews.ts";
import { rebasePlugin } from "./rebase.ts";
import { Screenshots } from "./screenshots.ts";
import { ViewStability } from "./stability.ts";
import { Workspace } from "./workspace.ts";

export interface ProjectOptions {
  /** Where Basis is installed: Vite's root for the preview. */
  root: string;
  /** Where Basis listens, and who may use it (server/network.ts). */
  network: Network;
  /** The preview's port; 0 takes a free one. */
  previewPort: number;
  /** The project's slot among those open (server/open-projects.ts): its own Vite cache, as projects run at once. */
  slot: number;
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

/** Answers 403 to requests for a host Basis does not answer to (isAllowedHost in server/network.ts). */
export function refuseHost(res: http.ServerResponse): void {
  res.writeHead(403, { "Content-Type": "text/plain" });
  res.end("Basis does not answer to this host name. On another machine, list it in BASIS_HOSTS.");
}

/**
 * Closes upgrade requests (Vite's hot reload socket) from a host Basis does not answer to, or without access.
 * Added before Vite's own listener, which then finds the socket closed.
 */
export function guardUpgrades(server: http.Server, network: Network, port: () => number): void {
  server.prependListener("upgrade", (req: http.IncomingMessage, socket: Duplex) => {
    if (!isAllowedHost(req, network, port()) || !hasAccess(req, network)) socket.destroy();
  });
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
 * compiles its components. Several are open at once (server/open-projects.ts),
 * each with a preview port of its own.
 */
export class OpenProject {
  private constructor(
    private current: ProjectEntry,
    readonly workspace: Workspace,
    readonly agent: AgentHost,
    private readonly root: string,
    private readonly previewServer: http.Server,
    private readonly previewVite: ViteDevServer,
    /** The preview's port. */
    readonly previewPort: number,
    /** Screenshots of specimens and view screens from this project's preview (server/screenshots.ts). */
    readonly screenshots: Screenshots,
    /** Holds the preview's changes while a turn runs (server/hold.ts). */
    readonly hold: PreviewHold,
    /** The chrome's origin, which the gallery in the background takes as its parent. */
    chromeOrigin: string,
  ) {
    this.background = new BackgroundPreview(
      screenshots,
      previewPort,
      chromeOrigin,
      // The page the turn changed most, as the gallery reloaded after it shows it; the user's own page is unknown here.
      () => ({
        design: workspace.state.design,
        theme: "light",
        page: pageForFiles(workspace.turnFiles),
        review: null,
        fullscreen: null,
        widths: workspace.widths,
        // The whole page, as the checks need it.
        focus: null,
        all: true,
      }),
      (report) =>
        report
          ? this.report(this.background, report.errors, false, report.checks, report.checking, report.generation)
          : this.forget(this.background),
    );
  }

  /** Render problems per tab showing this project; the fix loop gets the current tab's (see PreviewReports). */
  private readonly reports = new PreviewReports<unknown>();
  /** The gallery that reports for the project while no tab shows it and its agent works (server/background.ts). */
  private readonly background: BackgroundPreview;

  static async open(entry: ProjectEntry, options: ProjectOptions): Promise<OpenProject> {
    const workspace = new Workspace(entry.dir);
    await workspace.init();

    /*
     * The preview runs on its own port inside a sandboxed iframe, because it
     * executes component code the agent writes; a different port is a
     * different origin, so that code cannot reach the bridge or the chrome.
     * It listens first, since a free port is only known then; Vite answers
     * once it is set up, before the port is given to anyone.
     */
    const previewServer = http.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        previewServer.once("error", reject);
        previewServer.listen(options.previewPort, options.network.listen, resolve);
      });
      const previewPort = (previewServer.address() as AddressInfo).port;
      return await OpenProject.setUp(entry, options, workspace, previewServer, previewPort);
    } catch (error) {
      previewServer.close();
      await workspace.close();
      throw error;
    }
  }

  private static async setUp(
    entry: ProjectEntry,
    options: ProjectOptions,
    workspace: Workspace,
    previewServer: http.Server,
    previewPort: number,
  ): Promise<OpenProject> {
    const { root, broadcast } = options;
    const screenshots = new Screenshots(`http://${options.network.self}:${previewPort}/capture.html`, {
      widths: () => widthList(workspace.widths),
    });
    const views = new ViewStability(entry.dir, screenshots, () => workspace.state.design);
    const hold = new PreviewHold(broadcast);
    const agent = new AgentHost(workspace, options.agent, entry.repo, options.mcpServers, options.home, views, hold);
    await agent.restore();

    // Tokens and the review reach the chrome's preview when the turn ends, with the code (see PreviewHold).
    workspace.on("design", (design) => hold.send({ type: "design", design }));
    workspace.on("history", (history) => broadcast({ type: "history", history }));
    workspace.on("review", (review) => hold.send({ type: "review", review }));
    // The user chose them, so they reach the preview at once, also while a turn holds it.
    workspace.on("widths", (widths, before) => {
      agent.widthsChanged(widths, before);
      broadcast({ type: "widths", widths });
    });
    agent.on("agent", (state) => broadcast({ type: "agent", agent: state }));
    // Every thread's chat goes to every tab that shows the project; a tab keeps the thread it shows.
    agent.on("chat", (item, thread) => broadcast({ type: "chat-upsert", thread, item }));
    agent.on("chat-remove", (id, thread) => broadcast({ type: "chat-remove", thread, id }));
    agent.on("threads", (threads) => broadcast({ type: "threads", threads }));

    const previewVite = await createVite({
      root,
      appType: "mpa",
      // One cache per slot: Vite servers sharing one would race to write the deps they optimise.
      cacheDir: `node_modules/.vite/preview${options.slot ? `-${options.slot}` : ""}`,
      optimizeDeps: { entries: ["preview.html", "capture.html"] },
      plugins: [rebasePlugin(root, entry.dir), hold.plugin()],
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
    guardUpgrades(previewServer, options.network, () => previewPort);
    previewServer.on("request", (req, res) => {
      if (!isAllowedHost(req, options.network, previewPort)) return refuseHost(res);
      if (!hasAccess(req, options.network)) return refuseAccess(req, res, false);
      // The capture page (capture.html) reads the current tokens from here, as the kit's copy reads its own file.
      if (req.method === "GET" && req.url?.split("?")[0] === "/design.json") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(workspace.state.design));
        return;
      }
      previewGuard(req, res, () => previewVite.middlewares(req, res));
    });

    void agent.start();
    return new OpenProject(
      entry,
      workspace,
      agent,
      root,
      previewServer,
      previewVite,
      previewPort,
      screenshots,
      hold,
      options.chromeOrigins[0]!,
    );
  }

  get entry(): ProjectEntry {
    return this.current;
  }

  /** The widths the project shows and checks its design at (shared/widths.ts). */
  get widths(): Widths {
    return this.workspace.widths;
  }

  /** Sets the project's widths, or with null goes back to Basis' defaults; every tab that shows it hears of it. */
  setWidths(widths: Widths | null): Promise<void> {
    return this.workspace.setWidths(widths);
  }

  /** The agent runs a turn, its fix-ups or the prompts queued behind it. */
  get busy(): boolean {
    return this.agent.agent.status === "busy";
  }

  /** The agent waits for the user to answer a permission request. */
  get waiting(): boolean {
    return this.agent.waiting;
  }

  /** Records what a tab's preview of this project shows now (see PreviewReports), for the fix loop. */
  report(
    connection: unknown,
    errors: string[],
    visible: boolean,
    checks: string[],
    checking: boolean,
    generation: number,
  ): void {
    this.reports.report(connection, errors, visible, checks, checking, generation);
    this.passReports();
  }

  /** A tab no longer shows this project (it closed, or shows another). */
  forget(connection: unknown): void {
    this.reports.forget(connection);
    this.passReports();
  }

  /**
   * Whether a tab shows the project now; told on every change of its state (OpenProjects.update). While none does
   * and its agent works, the gallery runs in the background, so the fix loop still hears of render errors and checks.
   */
  setShown(shown: boolean): void {
    if (!shown && this.busy) this.background.start();
    else this.background.stop();
  }

  private passReports(): void {
    const { current, checks, checking, generation } = this.reports;
    this.agent.setPreviewErrors(current, checks, checking, generation);
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
    this.background.stop();
    await this.screenshots.close();
    await this.workspace.close();
    await this.previewVite.close();
    this.previewServer.closeAllConnections();
    await new Promise<void>((resolve) => this.previewServer.close(() => resolve()));
  }
}
