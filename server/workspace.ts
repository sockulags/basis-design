import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DESIGN, parseDesignText, type Design } from "../shared/design.ts";
import type { DesignState, HistoryEntry } from "../shared/protocol.ts";
import { AGENT_BRIEF, CLAUDE_MD } from "./brief.ts";

const DESIGN_FILE = "design-system.json";
const HISTORY_LIMIT = 200;

type Source = HistoryEntry["source"];

/**
 * The folder the agent works in. Owns design-system.json, validates every
 * change to it (whoever made it) and keeps a snapshot history for undo.
 */
export class Workspace extends EventEmitter<{ design: [DesignState]; history: [HistoryEntry[]] }> {
  readonly file: string;
  private readonly historyDir: string;
  private design: Design = DEFAULT_DESIGN;
  private errors: string[] | null = null;
  private lastSerialized = "";
  private lastSnapshot = "";
  private history: HistoryEntry[] = [];
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  /**
   * True while an agent turn runs. Changes still stream to the preview, but the
   * history snapshot waits for endTurn() so one prompt becomes one undo step.
   */
  agentActive = false;

  constructor(readonly dir: string) {
    super();
    this.file = path.join(dir, DESIGN_FILE);
    this.historyDir = path.join(dir, ".basis", "history");
  }

  async init(): Promise<void> {
    await mkdir(this.historyDir, { recursive: true });
    await writeFile(path.join(this.dir, "AGENTS.md"), AGENT_BRIEF);
    await writeFile(path.join(this.dir, "CLAUDE.md"), CLAUDE_MD);
    if (!existsSync(this.file)) await writeFile(this.file, serialize(DEFAULT_DESIGN));
    this.history = await this.loadHistory();
    await this.reload("init");
    this.watcher = watch(this.dir, (_event, filename) => {
      if (filename === DESIGN_FILE) this.scheduleReload();
    });
  }

  close(): void {
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
  }

  get state(): DesignState {
    return { design: this.design, errors: this.errors, workspace: this.dir };
  }

  get entries(): HistoryEntry[] {
    return this.history;
  }

  isInside(target: string): boolean {
    const relative = path.relative(this.dir, path.resolve(target));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  async revert(historyId: string): Promise<void> {
    const entry = this.history.find((item) => item.id === historyId);
    if (!entry) throw new Error(`Unknown history entry ${historyId}`);
    const text = await readFile(path.join(this.historyDir, `${entry.id}.json`), "utf8");
    await writeFile(this.file, text);
    await this.reload("revert");
  }

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.reload(), 60);
  }

  /** Re-reads the file. Valid changes become the current design and a history snapshot. */
  async reload(forcedSource?: Source): Promise<void> {
    clearTimeout(this.reloadTimer);
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch {
      return; // Mid-replace by an editor; the watcher fires again when the new file lands.
    }
    const result = parseDesignText(text);
    if (!result.ok) {
      this.errors = result.errors;
      this.emit("design", this.state);
      return;
    }
    const hadErrors = this.errors !== null;
    this.errors = null;
    const serialized = serialize(result.design);
    if (serialized === this.lastSerialized) {
      if (hadErrors) this.emit("design", this.state);
      return;
    }
    const isFirstLoad = this.lastSerialized === "";
    this.design = result.design;
    this.lastSerialized = serialized;
    this.emit("design", this.state);
    if (this.agentActive && !forcedSource) return;
    const source = forcedSource ?? "external";
    const latest = this.history.at(-1);
    if (isFirstLoad && latest && (await this.snapshotText(latest)) === serialized) {
      this.lastSnapshot = serialized;
      return;
    }
    await this.snapshot(serialized, source);
  }

  beginTurn(): void {
    this.agentActive = true;
  }

  /** Re-reads the file after an agent turn and records one history entry if the design changed. */
  async endTurn(): Promise<void> {
    await this.reload();
    this.agentActive = false;
    if (this.lastSerialized !== this.lastSnapshot) await this.snapshot(this.lastSerialized, "agent");
  }

  private async snapshotText(entry: HistoryEntry): Promise<string | null> {
    try {
      return await readFile(path.join(this.historyDir, `${entry.id}.json`), "utf8");
    } catch {
      return null;
    }
  }

  private async snapshot(serialized: string, source: Source): Promise<void> {
    const at = Date.now();
    const id = `${at}-${source}`;
    await writeFile(path.join(this.historyDir, `${id}.json`), serialized);
    this.lastSnapshot = serialized;
    this.history.push({ id, at, source, name: this.design.name });
    while (this.history.length > HISTORY_LIMIT) {
      const dropped = this.history.shift();
      if (dropped) await rm(path.join(this.historyDir, `${dropped.id}.json`), { force: true });
    }
    this.emit("history", this.history);
  }

  private async loadHistory(): Promise<HistoryEntry[]> {
    const files = (await readdir(this.historyDir)).filter((file) => file.endsWith(".json")).sort();
    const entries: HistoryEntry[] = [];
    for (const file of files) {
      const id = file.slice(0, -".json".length);
      const [stamp, source] = id.split("-");
      const at = Number(stamp);
      if (!Number.isFinite(at) || !isSource(source)) continue;
      let name = "";
      try {
        name = (JSON.parse(await readFile(path.join(this.historyDir, file), "utf8")) as { name?: string }).name ?? "";
      } catch {
        continue;
      }
      entries.push({ id, at, source, name });
    }
    return entries;
  }
}

function isSource(value: string | undefined): value is Source {
  return value === "init" || value === "agent" || value === "revert" || value === "external";
}

function serialize(design: Design): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}
