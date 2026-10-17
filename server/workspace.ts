import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DESIGN, parseDesignText, type Design } from "../shared/design.ts";
import { diffDesigns } from "../shared/diff.ts";
import { SOURCE_FOLDERS } from "../shared/frame.ts";
import type { DesignState, HistoryEntry, Snapshot } from "../shared/protocol.ts";
import { parseReviewRequest, REVIEW_FILE, type ReviewRequest, type ReviewState } from "../shared/review.ts";
import { AGENT_BRIEF, CLAUDE_MD } from "./brief.ts";
import { git, typecheck } from "./exec.ts";

const DESIGN_FILE = "design-system.json";
const COMPONENTS_DIR = "components";
const PATTERNS_DIR = "patterns";
/** Folders of agent-owned source, one per gallery page: base components, patterns composed from them. */
const SOURCE_DIRS: string[] = SOURCE_FOLDERS;
const isSourcePath = (relative: string) => SOURCE_DIRS.some((dir) => relative.startsWith(`${dir}/`));
const HISTORY_LIMIT = 300;
const DIFF_LIMIT = 400_000;
const COMMIT_ID = /^[0-9a-f]{40}$/;
/** Where an open review keeps its iterations: a ref outside branches, so history (main) never shows them. */
const REVIEW_REF = "refs/basis/review";
const REVIEW_STATE_FILE = "review.json";

type Source = HistoryEntry["source"];
type EntryMeta = Pick<HistoryEntry, "label" | "restoredFrom">;

const repoRoot = path.resolve(import.meta.dirname, "..");

/**
 * The folder the agent works in: design-system.json plus the component source
 * in components/. Validates and type-checks every change, and records history
 * as git commits so undo covers tokens and code alike.
 */
export class Workspace extends EventEmitter<{ design: [DesignState]; history: [HistoryEntry[]]; review: [ReviewState | null] }> {
  readonly file: string;
  readonly componentsDir: string;
  readonly patternsDir: string;
  private readonly basisDir: string;
  private design: Design = DEFAULT_DESIGN;
  private errors: string[] | null = null;
  private typeErrors: string[] | null = null;
  private history: HistoryEntry[] = [];
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private settleTimer?: NodeJS.Timeout;
  private reviewTimer?: NodeJS.Timeout;
  private turnLabel = "";
  private reviewState: ReviewState | null = null;
  private reviewErrors: string[] | null = null;
  /** Snapshots being written, so concurrent requests for one version share the work. */
  private materialising = new Map<string, Promise<string>>();
  /** Serialises git operations; concurrent commits would race on the index. */
  private queue: Promise<unknown> = Promise.resolve();
  /** True while an agent turn runs; its changes are committed once, when the turn ends. */
  agentActive = false;

  constructor(readonly dir: string) {
    super();
    this.file = path.join(dir, DESIGN_FILE);
    this.componentsDir = path.join(dir, COMPONENTS_DIR);
    this.patternsDir = path.join(dir, PATTERNS_DIR);
    this.basisDir = path.join(dir, ".basis");
  }

  async init(): Promise<void> {
    await mkdir(this.basisDir, { recursive: true });
    await this.writeGeneratedFiles();
    if (!existsSync(this.file)) await writeFile(this.file, serialize(DEFAULT_DESIGN));
    // Seed new workspaces; bring older ones up to date with what Basis added since.
    const notes: string[] = [];
    if (!existsSync(this.componentsDir)) await this.seed(COMPONENTS_DIR);
    else if (!existsSync(path.join(this.componentsDir, "specimen.ts"))) {
      await this.seed(COMPONENTS_DIR, (name) => name.includes("specimen"));
      notes.push("gallery specimens");
    }
    if (!existsSync(path.join(this.componentsDir, "contracts.ts"))) {
      await this.seed(COMPONENTS_DIR, (name) => name === "contracts.ts");
      notes.push("component contracts");
    }
    if (!existsSync(this.patternsDir)) {
      const fresh = notes.length === 0 && !existsSync(path.join(this.dir, ".git"));
      await this.seed(PATTERNS_DIR);
      if (!fresh) notes.push("starter patterns");
    }
    const note = notes.length ? `Basis added ${notes.join(" and ")}` : "";
    if (!existsSync(path.join(this.dir, ".git"))) await git(this.dir, ["init", "-q", "-b", "main"]);
    // An open review survives restarts; load it first so changes made meanwhile land in it.
    await this.loadReview();
    await this.reload();
    await this.check();
    const hasCommits = (await git(this.dir, ["rev-list", "-n", "1", "--all"]).catch(() => "")).trim() !== "";
    await this.commit(hasCommits ? "external" : "init", note ? { label: note } : {});
    this.history = await this.loadHistory();
    await this.pruneSnapshots();
    await this.readReviewRequest();
    this.watcher = watch(this.dir, { recursive: true }, (_event, filename) => this.onFsEvent(filename));
  }

  close(): void {
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.reviewTimer);
  }

  get state(): DesignState {
    return {
      design: this.design,
      errors: this.errors,
      typeErrors: this.typeErrors,
      reviewErrors: this.reviewErrors,
      workspace: this.dir,
    };
  }

  get entries(): HistoryEntry[] {
    return this.history;
  }

  get review(): ReviewState | null {
    return this.reviewState;
  }

  /** Approves the open review: everything it changed becomes one history entry. */
  async approveReview(): Promise<void> {
    await this.serial(async () => {
      const review = this.reviewState;
      if (!review) return;
      this.reviewState = null;
      await this.commitNow("review", { label: review.title });
      await this.endReview();
    });
  }

  /** Discards the open review: the workspace goes back to where the review started. */
  async discardReview(): Promise<void> {
    await this.serial(async () => {
      const review = this.reviewState;
      if (!review) return;
      await git(this.dir, ["add", "-A"]);
      await git(this.dir, ["restore", `--source=${review.baseline}`, "--staged", "--worktree", "--", "."]);
      this.reviewState = null;
      await this.endReview();
    });
    await this.reload();
    await this.check();
  }

  /** Goes back to an earlier iteration; recorded as a new iteration, so nothing is lost. */
  async reviewStep(stepId: string): Promise<void> {
    await this.serial(async () => {
      const review = this.reviewState;
      const index = review?.steps.findIndex((step) => step.id === stepId) ?? -1;
      if (!review || index === -1 || index === review.steps.length - 1) return;
      await git(this.dir, ["add", "-A"]);
      await git(this.dir, ["restore", `--source=${stepId}`, "--staged", "--worktree", "--", "."]);
      await this.recordStep(`Back to iteration ${index + 1}`);
    });
    await this.reload();
    await this.check();
  }

  /**
   * A past version for a review: its tokens, and a read-only copy of
   * its source under .basis/snapshots/<id>/ that the preview can import, so
   * that version's component code runs next to today's.
   */
  async baseline(historyId: string): Promise<{ id: string; design: Design; dir: string } | null> {
    if (!(await this.isCommit(historyId))) return null;
    try {
      const result = parseDesignText(await git(this.dir, ["show", `${historyId}:${DESIGN_FILE}`]));
      if (!result.ok) return null;
      return { id: historyId, design: result.design, dir: await this.materialise(historyId) };
    } catch {
      return null;
    }
  }

  isInside(target: string): boolean {
    const relative = path.relative(this.dir, path.resolve(target));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  /** Files the agent may change: the design file, review.json and anything under components/ or patterns/. */
  isEditable(target: string): boolean {
    if (!this.isInside(target)) return false;
    const relative = path.relative(this.dir, path.resolve(target)).split(path.sep).join("/");
    return relative === DESIGN_FILE || relative === REVIEW_FILE || isSourcePath(relative);
  }

  /** Marks the start of an agent turn; `label` is the prompt that started it. */
  async beginTurn(label: string): Promise<void> {
    // Anything changed by hand since the last entry gets its own entry first.
    await this.commit("external", {});
    this.agentActive = true;
    this.turnLabel = label;
  }

  /** After a turn: re-read, type-check and record one history entry for everything the turn changed. */
  async endTurn(): Promise<void> {
    await this.reload();
    // A review the agent opened this turn must exist before the turn is recorded, so the turn lands in it.
    await this.readReviewRequest();
    await this.check();
    this.agentActive = false;
    await this.commit("agent", { label: this.turnLabel });
  }

  async revert(historyId: string): Promise<void> {
    // History stays put while a review is open; the review has its own iterations.
    if (this.reviewState) return;
    const entry = this.history.find((item) => item.id === historyId);
    if (!entry) throw new Error(`Unknown history entry ${historyId}`);
    await this.serial(() => git(this.dir, ["restore", `--source=${entry.id}`, "--staged", "--worktree", "--", "."]));
    await this.reload();
    await this.check();
    await this.commit("revert", { label: entry.label ?? describeSource(entry.source), restoredFrom: entry.id });
  }

  /** A past version for read-only inspection: its tokens, plus how its component code differs from now. */
  async snapshot(historyId: string): Promise<Snapshot | null> {
    if (!this.history.some((item) => item.id === historyId)) return null;
    try {
      const result = parseDesignText(await git(this.dir, ["show", `${historyId}:${DESIGN_FILE}`]));
      if (!result.ok) return null;
      const files = (await git(this.dir, ["diff", "--name-only", historyId, "--", ...SOURCE_DIRS]))
        .split("\n")
        .filter(Boolean);
      let codeDiff = files.length ? await git(this.dir, ["diff", "--no-color", "-R", historyId, "--", ...SOURCE_DIRS]) : "";
      if (codeDiff.length > DIFF_LIMIT) codeDiff = `${codeDiff.slice(0, DIFF_LIMIT)}\n… diff truncated`;
      return { id: historyId, design: result.design, files, codeDiff };
    } catch {
      return null;
    }
  }

  private async isCommit(id: string): Promise<boolean> {
    if (!COMMIT_ID.test(id)) return false;
    return git(this.dir, ["cat-file", "-e", `${id}^{commit}`]).then(
      () => true,
      () => false,
    );
  }

  /** Writes the source folders of a commit to .basis/snapshots/<id>/ once; later calls reuse the copy. */
  private materialise(id: string): Promise<string> {
    const target = path.join(this.basisDir, "snapshots", id);
    const pending = this.materialising.get(id);
    if (pending) return pending;
    const done = path.join(target, ".complete");
    const work = (async () => {
      if (existsSync(done)) return target;
      await rm(target, { recursive: true, force: true });
      const names = (await git(this.dir, ["ls-tree", "-r", "-z", "--name-only", id, "--", ...SOURCE_DIRS])).split("\0").filter(Boolean);
      await Promise.all(
        names.map(async (name) => {
          const file = path.join(target, ...name.split("/"));
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, await git(this.dir, ["show", `${id}:${name}`]));
        }),
      );
      await writeFile(done, "");
      return target;
    })().finally(() => this.materialising.delete(id));
    this.materialising.set(id, work);
    return work;
  }

  /** Drops snapshot copies the open review does not use. */
  private async pruneSnapshots(): Promise<void> {
    const snapshots = path.join(this.basisDir, "snapshots");
    if (!existsSync(snapshots)) return;
    for (const name of await readdir(snapshots)) {
      if (name !== this.reviewState?.baseline) await rm(path.join(snapshots, name), { recursive: true, force: true });
    }
  }

  /**
   * Reads the agent's review.json: opens a review when none is open, or
   * updates what the open one shows. Problems are reported like token errors.
   */
  private async readReviewRequest(): Promise<void> {
    let text: string;
    try {
      text = await readFile(path.join(this.dir, REVIEW_FILE), "utf8");
    } catch {
      // No request (or the agent removed it): an open review stays open until approved or discarded.
      return this.setReviewErrors(null);
    }
    const result = parseReviewRequest(text);
    if (!result.ok) return this.setReviewErrors(result.errors);
    this.setReviewErrors(null);
    await this.serial(() => this.applyReviewRequest(result.request));
  }

  private setReviewErrors(errors: string[] | null): void {
    if (JSON.stringify(errors) === JSON.stringify(this.reviewErrors)) return;
    this.reviewErrors = errors;
    this.emit("design", this.state);
  }

  private async applyReviewRequest(request: ReviewRequest): Promise<void> {
    const current = this.reviewState;
    if (current && current.title === request.title && JSON.stringify(current.show) === JSON.stringify(request.show)) return;
    // A new review starts from the last recorded version: during a turn, that is the state before the turn.
    const baseline = current?.baseline ?? (await git(this.dir, ["rev-parse", "HEAD"])).trim();
    this.reviewState = current
      ? { ...current, title: request.title, show: request.show }
      : { ...request, baseline, startedAt: Date.now(), steps: [], files: [] };
    await this.saveReview();
  }

  /** Records the working tree as the next iteration of the open review, if it changed. */
  private async recordStep(label: string): Promise<void> {
    const review = this.reviewState;
    if (!review) return;
    await git(this.dir, ["add", "-A"]);
    const tree = (await git(this.dir, ["write-tree"])).trim();
    const parent = review.steps.at(-1)?.id ?? review.baseline;
    if (tree === (await git(this.dir, ["rev-parse", `${parent}^{tree}`])).trim()) return;
    const id = (await git(this.dir, ["commit-tree", tree, "-p", parent, "-m", `review: ${label.slice(0, 72)}`])).trim();
    await git(this.dir, ["update-ref", REVIEW_REF, id]);
    const files = (await git(this.dir, ["diff", "--name-only", review.baseline, id, "--", ...SOURCE_DIRS]))
      .split("\n")
      .filter(Boolean);
    this.reviewState = { ...review, steps: [...review.steps, { id, at: Date.now(), label }], files };
    await this.saveReview();
  }

  private async saveReview(): Promise<void> {
    await writeFile(path.join(this.basisDir, REVIEW_STATE_FILE), `${JSON.stringify(this.reviewState, null, 2)}\n`);
    this.emit("review", this.reviewState);
  }

  /** Clears what an ended review left behind: its iterations ref, its saved state and the agent's request. */
  private async endReview(): Promise<void> {
    await git(this.dir, ["update-ref", "-d", REVIEW_REF]).catch(() => undefined);
    await rm(path.join(this.basisDir, REVIEW_STATE_FILE), { force: true });
    await rm(path.join(this.dir, REVIEW_FILE), { force: true });
    this.reviewErrors = null;
    this.emit("review", null);
    this.emit("design", this.state);
    await this.pruneSnapshots();
  }

  private async loadReview(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.basisDir, REVIEW_STATE_FILE), "utf8")) as ReviewState;
      const valid =
        typeof raw.title === "string" &&
        Array.isArray(raw.show) &&
        Array.isArray(raw.steps) &&
        (await this.isCommit(raw.baseline)) &&
        (await Promise.all(raw.steps.map((step) => this.isCommit(step.id)))).every(Boolean);
      this.reviewState = valid ? { ...raw, files: Array.isArray(raw.files) ? raw.files : [] } : null;
    } catch {
      this.reviewState = null;
    }
  }

  private onFsEvent(filename: string | Buffer | null): void {
    const name = String(filename ?? "").split(path.sep).join("/");
    if (!name || name.startsWith(".git") || name.startsWith(".basis") || name.includes("node_modules")) return;
    if (name === REVIEW_FILE) {
      clearTimeout(this.reviewTimer);
      this.reviewTimer = setTimeout(() => void this.readReviewRequest(), 120);
      return;
    }
    if (name === DESIGN_FILE) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reload(), 60);
    }
    if (name !== DESIGN_FILE && !isSourcePath(name)) return;
    // Hand edits are checked and recorded once things settle; agent turns are handled by endTurn().
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.agentActive) return;
      void (async () => {
        await this.check();
        await this.commit("external", {});
      })();
    }, 900);
  }

  /** Re-reads design-system.json. A valid file becomes the current design; an invalid one is reported. */
  async reload(): Promise<void> {
    clearTimeout(this.reloadTimer);
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch {
      return; // Mid-replace by an editor; the watcher fires again when the new file lands.
    }
    const result = parseDesignText(text);
    if (result.ok) {
      const changed = serialize(result.design) !== serialize(this.design);
      const hadErrors = this.errors !== null;
      this.design = result.design;
      this.errors = null;
      if (changed || hadErrors) this.emit("design", this.state);
    } else {
      this.errors = result.errors;
      this.emit("design", this.state);
    }
  }

  /** Type-checks components/ against the gallery contracts. */
  async check(): Promise<string[]> {
    const errors = await typecheck(this.dir).catch((error: Error) => [error.message]);
    const next = errors.length ? errors.slice(0, 50) : null;
    if (JSON.stringify(next) !== JSON.stringify(this.typeErrors)) {
      this.typeErrors = next;
      this.emit("design", this.state);
    }
    return errors;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Records the working tree if anything changed: as a history entry, or as
   * the next iteration while a review is open (the review becomes one entry
   * when it is approved).
   */
  private commit(source: Source, meta: EntryMeta): Promise<void> {
    return this.serial(() =>
      this.reviewState ? this.recordStep(meta.label ?? describeSource(source)) : this.commitNow(source, meta),
    );
  }

  /** Commits the working tree to history. Token-level changes are recorded in the message for the history list. */
  private async commitNow(source: Source, meta: EntryMeta): Promise<void> {
    await git(this.dir, ["add", "-A"]);
    const staged = (await git(this.dir, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    const isFirst = (await git(this.dir, ["rev-list", "-n", "1", "--all"]).catch(() => "")).trim() === "";
    if (staged.length === 0 && !isFirst) return;
    let changed: string[] = [];
    if (!isFirst && staged.includes(DESIGN_FILE)) {
      const before = parseDesignText(await git(this.dir, ["show", `HEAD:${DESIGN_FILE}`]).catch(() => ""));
      const after = parseDesignText(await readFile(this.file, "utf8").catch(() => ""));
      if (before.ok && after.ok) changed = diffDesigns(before.design, after.design).map((change) => change.path);
    }
    const label = meta.label?.replace(/\s+/g, " ").trim();
    const message = [
      label ? `${source}: ${label.slice(0, 72)}` : source,
      "",
      `Basis-Source: ${source}`,
      `Basis-Name: ${this.design.name}`,
      label ? `Basis-Label: ${label}` : "",
      meta.restoredFrom ? `Basis-Restored-From: ${meta.restoredFrom}` : "",
      changed.length ? `Basis-Changed: ${changed.join(",")}` : "",
    ]
      .filter((line, index) => index < 2 || line)
      .join("\n");
    await git(this.dir, ["commit", "-q", "--allow-empty", "-m", message]);
    this.history = await this.loadHistory();
    this.emit("history", this.history);
  }

  private async loadHistory(): Promise<HistoryEntry[]> {
    let raw: string;
    try {
      raw = await git(this.dir, ["log", `-n${HISTORY_LIMIT}`, "--name-only", "--format=%x1e%H%x1f%ct%x1f%B%x1f"]);
    } catch {
      return [];
    }
    const entries: HistoryEntry[] = [];
    for (const record of raw.split("\x1e").slice(1)) {
      const [id = "", time = "0", body = "", names = ""] = record.split("\x1f");
      const trailers = new Map<string, string>();
      for (const line of body.split("\n")) {
        const match = /^Basis-([A-Za-z-]+): (.*)$/.exec(line.trim());
        if (match?.[1] && match[2] !== undefined) trailers.set(match[1], match[2]);
      }
      const source = trailers.get("Source");
      entries.push({
        id,
        at: Number(time) * 1000,
        source: isSource(source) ? source : "external",
        name: trailers.get("Name") ?? "",
        label: trailers.get("Label"),
        restoredFrom: trailers.get("Restored-From"),
        changed: trailers.get("Changed")?.split(",").filter(Boolean) ?? [],
        files: names
          .split("\n")
          .map((name) => name.trim())
          .filter(isSourcePath),
      });
    }
    return entries.reverse();
  }

  /**
   * Copies starter files from template/<folder> that are missing, normalising
   * line endings (a Windows checkout of Basis may have CRLF).
   */
  private async seed(folder: string, only: (name: string) => boolean = () => true): Promise<void> {
    const source = path.join(repoRoot, "template", folder);
    const destination = path.join(this.dir, folder);
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(source)) {
      if (!only(name) || existsSync(path.join(destination, name))) continue;
      const text = await readFile(path.join(source, name), "utf8");
      await writeFile(path.join(destination, name), text.replaceAll("\r\n", "\n"));
    }
  }

  /** Files Basis owns in the workspace, rewritten on every start and kept out of history. */
  private async writeGeneratedFiles(): Promise<void> {
    const types = (pkg: string) => path.join(repoRoot, "node_modules", pkg).split(path.sep).join("/");
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        allowImportingTsExtensions: true,
        types: [],
        // Resolve React's types from the Basis install, wherever this workspace lives.
        paths: {
          react: [`${types("@types/react")}/index.d.ts`],
          "react/*": [`${types("@types/react")}/*`],
          "react-dom": [`${types("@types/react-dom")}/index.d.ts`],
          "react-dom/*": [`${types("@types/react-dom")}/*`],
        },
      },
      include: [...SOURCE_DIRS.map((dir) => `${dir}/**/*`), ".basis/*.ts"],
    };
    await writeFile(path.join(this.dir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
    await writeFile(path.join(this.basisDir, "contracts.ts"), await readFile(path.join(repoRoot, "shared", "contracts.ts"), "utf8"));
    await writeFile(
      path.join(this.basisDir, "env.d.ts"),
      'declare module "*.module.css" {\n  const classes: Record<string, string>;\n  export default classes;\n}\n',
    );
    await writeFile(
      path.join(this.basisDir, "check.ts"),
      [
        "// Fails to type-check when components/ stops satisfying its contracts: the Basis baseline",
        "// (./contracts.ts) and the contracts this design system added (components/contracts.ts).",
        'import type { Contracts } from "./contracts.ts";',
        'import type { AddedContracts } from "../components/contracts.ts";',
        'import * as components from "../components/index.ts";',
        "",
        "export const satisfiesContracts: Contracts & AddedContracts = components;",
        "",
        "// Every export of components/index.ts needs a contract; add missing ones to components/contracts.ts.",
        "type Uncovered = Exclude<keyof typeof components, keyof Contracts | keyof AddedContracts>;",
        "export const everyExportHasAContract: [Uncovered] extends [never] ? true : { missingContractFor: Uncovered } = true;",
        "",
      ].join("\n"),
    );
    await writeFile(path.join(this.dir, "AGENTS.md"), AGENT_BRIEF);
    await writeFile(path.join(this.dir, "CLAUDE.md"), CLAUDE_MD);
    await writeFile(
      path.join(this.dir, ".gitignore"),
      `# Generated by Basis on every start\n.basis/\nAGENTS.md\nCLAUDE.md\ntsconfig.json\nnode_modules/\n${REVIEW_FILE}\n`,
    );
  }
}

function describeSource(source: Source): string {
  if (source === "init") return "Starting point";
  if (source === "external") return "Edit on disk";
  if (source === "review") return "Approved review";
  return "Earlier version";
}

function isSource(value: string | undefined): value is Source {
  return value === "init" || value === "agent" || value === "revert" || value === "external" || value === "review";
}

function serialize(design: Design): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}
