import type { EnvironmentModuleGraph, EnvironmentModuleNode, Plugin, ViteDevServer } from "vite";
import { HOLD_EVENT, HOLD_META, holdMeta, RELEASE_EVENT, type ReleasePayload } from "../shared/hold.ts";
import type { ServerMessage } from "../shared/protocol.ts";

/** Messages to the chrome that change what the preview shows; while held, the latest of each waits for the release. */
type HeldMessage = Extract<ServerMessage, { type: "design" | "review" }>;

/**
 * Holds what the preview shows while an agent turn runs, so the gallery never renders a half-written file or an
 * import of a file not written yet, and shows the turn's result at once when the turn ends.
 *
 * - Code: the preview server's `hotUpdate` hook drops every update while held. Vite has already cleared the changed
 *   file's transform by then, and the hook invalidates what the update would have reached, so a page loaded fresh
 *   (the agent's screenshots, the stability check) sees the files as they are now.
 * - Tokens and the review: the workspace's `design` and `review` messages to the chrome wait, the latest of each.
 *
 * When the turn ends and anything changed, the gallery reloads once (only preview.html listens; capture pages never
 * reload mid-capture), so no module that failed to load mid-turn and no error from before the turn stays behind.
 * Each such reload starts a new generation, which every gallery document is served with (a meta tag), so the fix loop
 * can tell a report from after the reload from one before it.
 */
export class PreviewHold {
  private held = false;
  /** Something the gallery shows changed while held, so it reloads at the release. */
  private changed = false;
  private reloads = 0;
  private messages = new Map<HeldMessage["type"], HeldMessage>();
  private server?: ViteDevServer;

  constructor(private readonly broadcast: (message: ServerMessage) => void) {}

  /** True while a turn holds changes back; the chrome then says the preview updates when the agent is done. */
  get waiting(): boolean {
    return this.held && this.changed;
  }

  /** Starts holding (a turn begins). */
  hold(): void {
    if (this.held) return;
    this.held = true;
    this.server?.environments.client.hot.send(HOLD_EVENT);
  }

  /**
   * Stops holding (the turn ended): sends what waited and reloads the gallery when anything changed. Returns the
   * generation the reloaded gallery reports, or null when nothing changed and the gallery shows what it showed.
   */
  release(): number | null {
    if (!this.held) return null;
    const changed = this.changed;
    this.held = false;
    this.changed = false;
    for (const message of this.messages.values()) this.broadcast(message);
    this.messages.clear();
    if (changed) {
      this.reloads += 1;
      this.broadcast({ type: "preview-waiting", waiting: false });
    }
    const payload: ReleasePayload = { reload: changed };
    this.server?.environments.client.hot.send(RELEASE_EVENT, payload);
    return changed ? this.reloads : null;
  }

  /** Passes a message for the chrome on, or keeps it for the release while held. */
  send(message: HeldMessage): void {
    if (!this.held) return this.broadcast(message);
    this.messages.set(message.type, message);
    this.markChanged();
  }

  private markChanged(): void {
    if (this.changed) return;
    this.changed = true;
    this.broadcast({ type: "preview-waiting", waiting: true });
  }

  /** The preview server's side: holds code updates, and tells each gallery document its generation. */
  plugin(): Plugin {
    const update = (graph: EnvironmentModuleGraph, modules: EnvironmentModuleNode[], timestamp: number) => {
      if (!this.held) return undefined;
      if (modules.length) {
        invalidate(graph, modules, timestamp);
        this.markChanged();
      }
      return [];
    };
    return {
      name: "basis-hold",
      configureServer: (server) => {
        this.server = server;
      },
      transformIndexHtml: (_html, context) => {
        if (!context.path.endsWith("/preview.html")) return;
        const content = holdMeta({ generation: this.reloads, held: this.held });
        return [{ tag: "meta", attrs: { name: HOLD_META, content }, injectTo: "head" }];
      },
      hotUpdate: {
        // Last, so what other plugins add to an update (the specimen glob, for a new file) is held as well.
        order: "post",
        handler({ modules, timestamp }) {
          return update(this.environment.moduleGraph, modules, timestamp);
        },
      },
    };
  }
}

/** Invalidates what Vite's own update would (the modules and the importers that do not accept them), sending nothing. */
export function invalidate(
  graph: Pick<EnvironmentModuleGraph, "invalidateModule">,
  modules: EnvironmentModuleNode[],
  timestamp: number,
): void {
  const seen = new Set<EnvironmentModuleNode>();
  for (const mod of modules) graph.invalidateModule(mod, seen, timestamp, true);
}
