import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DESIGN, parseDesignText, type Design } from "../shared/design.ts";
import { fixedColorFindings } from "../shared/fixed-colors.ts";
import type { DesignState, HistoryEntry, Snapshot, TemplateUpdate } from "../shared/protocol.ts";
import { REVIEW_FILE, type ReviewState } from "../shared/review.ts";
import { DEFAULT_WIDTHS, type Widths } from "../shared/widths.ts";
import { git, lines, typecheck } from "./exec.ts";
import { commitToHistory, describeSource, loadHistory, type EntryMeta, type Source } from "./history.ts";
import { DESIGN_FILE, isSourcePath, PRODUCT_FILE, relativeInside, SOURCE_DIRS } from "./paths.ts";
import { reachedSpecimens } from "./reach.ts";
import { Reviews } from "./reviews.ts";
import { claimWorkspaceFormat, seedWorkspace, writeGeneratedFiles } from "./setup.ts";
import { recordTemplateVersion, templateUpdate, writeTemplateCopy } from "./template.ts";
import { Snapshots } from "./snapshots.ts";
import { readWidths, saveWidths } from "./widths.ts";

const DIFF_LIMIT = 400_000;

type Events = {
  design: [DesignState];
  history: [HistoryEntry[]];
  review: [ReviewState | null];
  /** The project's widths changed (the new ones, and the ones before). */
  widths: [Widths, Widths];
};

/**
 * The folder the agent works in: design-system.json plus the source in
 * components/, patterns/ and views/. Validates and type-checks every change, and
 * records it as git history (or as an iteration of the open review), so undo
 * covers tokens and code alike. It coordinates the parts: setup, history,
 * reviews and snapshots each live in their own module.
 */
export class Workspace extends EventEmitter<Events> {
  readonly file: string;
  private design: Design = DEFAULT_DESIGN;
  private errors: string[] | null = null;
  private typeErrors: string[] | null = null;
  private colorFindings: string[] = [];
  private history: HistoryEntry[] = [];
  private readonly reviews: Reviews;
  private readonly snapshots: Snapshots;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private settleTimer?: NodeJS.Timeout;
  private reviewTimer?: NodeJS.Timeout;
  private turnLabel = "";
  /** The title of the thread whose turn runs, for its history entry. */
  private turnThread?: string;
  /** A set of alternatives being made before a review holds it: what was asked, and where the takes start. */
  private pendingAlternatives?: { prompt: string; start: string; count: number };
  /** Serialises git operations; concurrent commits would race on the index. */
  private queue: Promise<unknown> = Promise.resolve();
  /** A hand edit being checked and recorded (see onFsEvent); close() waits for it. */
  private settling: Promise<void> = Promise.resolve();
  private closed = false;
  /** A newer starter template this workspace has not caught up with (see server/template.ts). */
  private template: TemplateUpdate | null = null;
  /** The project's widths for Mobile, Tablet and Desktop (server/widths.ts). */
  private currentWidths: Widths = DEFAULT_WIDTHS;
  /** True while an agent turn runs; its changes are committed once, when the turn ends. */
  agentActive = false;
  /** The tree the running turn started from, and what the last turn changed (turnFiles). */
  private turnStart?: string;
  private changedInTurn: string[] = [];

  /** `options.typecheck` replaces the tsc run (tests use a fast stand-in). */
  constructor(
    readonly dir: string,
    private readonly options: { typecheck?: (dir: string) => Promise<string[]> } = {},
  ) {
    super();
    this.file = path.join(dir, DESIGN_FILE);
    this.reviews = new Reviews(dir);
    this.snapshots = new Snapshots(dir);
  }

  async init(): Promise<void> {
    await claimWorkspaceFormat(this.dir);
    await writeGeneratedFiles(this.dir);
    this.currentWidths = await readWidths(this.dir);
    if (!existsSync(this.file)) await writeFile(this.file, serialize(DEFAULT_DESIGN));
    const note = await seedWorkspace(this.dir);
    if (!existsSync(path.join(this.dir, ".git"))) await git(this.dir, ["init", "-q", "-b", "main"]);
    // An open review survives restarts; load it first so changes made meanwhile land in it.
    await this.reviews.load();
    await this.reload();
    await this.check();
    const hasCommits = (await git(this.dir, ["rev-list", "-n", "1", "--all"]).catch(() => "")).trim() !== "";
    await this.commit(hasCommits ? (note ? "upgrade" : "external") : "init", note ? { label: note } : {});
    this.history = await loadHistory(this.dir);
    this.template = await templateUpdate(this.dir);
    if (this.template) await writeTemplateCopy(this.dir);
    // Copies of past versions from earlier runs, except the open review's starting point.
    await this.snapshots.prune(this.reviews.state?.baseline);
    await this.readReviewRequest();
    this.watcher = watch(this.dir, { recursive: true }, (_event, filename) => this.onFsEvent(filename));
  }

  /**
   * Stops watching and waits for git work already under way, so nothing runs in the folder once this resolves
   * (the next project, or a test removing the folder, may follow at once).
   */
  async close(): Promise<void> {
    this.closed = true;
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.reviewTimer);
    await this.settling;
    await this.queue;
  }

  get state(): DesignState {
    return {
      design: this.design,
      errors: this.errors,
      typeErrors: this.typeErrors,
      reviewErrors: this.reviews.errors,
      colorFindings: this.colorFindings,
      workspace: this.dir,
      templateUpdate: this.template,
    };
  }

  /** The widths the project shows and checks its design at. */
  get widths(): Widths {
    return this.currentWidths;
  }

  /**
   * Sets the project's widths, or with null goes back to Basis' defaults. They are Basis' setting, outside git: no
   * history entry, and restoring a past version or discarding a review keeps them.
   */
  async setWidths(widths: Widths | null): Promise<void> {
    await saveWidths(this.dir, widths);
    const before = this.currentWidths;
    this.currentWidths = widths ?? DEFAULT_WIDTHS;
    this.emit("widths", this.currentWidths, before);
  }

  get templateUpdate(): TemplateUpdate | null {
    return this.template;
  }

  /** Records the newer template as caught up with, whether its changes were brought in or skipped. */
  async settleTemplateUpdate(): Promise<void> {
    if (!this.template) return;
    await recordTemplateVersion(this.dir, this.template.to);
    this.template = null;
    this.emit("design", this.state);
  }

  get entries(): HistoryEntry[] {
    return this.history;
  }

  get review(): ReviewState | null {
    return this.reviews.state;
  }

  /** True for a path inside the workspace, also after following links (`relativeInside`). */
  isInside(target: string): boolean {
    const relative = relativeInside(this.dir, target);
    return relative !== null && relative !== "";
  }

  /** Files the agent may change: the design file, review.json, product.md and anything in the source folders. */
  isEditable(target: string): boolean {
    const relative = relativeInside(this.dir, target);
    if (!relative) return false;
    return relative === DESIGN_FILE || relative === REVIEW_FILE || relative === PRODUCT_FILE || isSourcePath(relative);
  }

  /** Marks the start of an agent turn; `label` is the prompt that started it, `thread` the title of its thread. */
  async beginTurn(label: string, thread?: string): Promise<void> {
    // Set first, so a hand edit's check still under way (onFsEvent) does not record the agent's changes as its own.
    this.agentActive = true;
    this.turnLabel = label;
    this.turnThread = thread;
    // Anything changed by hand since the last entry gets its own entry first.
    await this.commit("external", {});
    this.turnStart = await this.serial(() => this.workingTree()).catch(() => undefined);
  }

  /** After a turn: re-read, type-check and record one history entry (or iteration) for everything it changed. */
  async endTurn(): Promise<void> {
    await this.reload();
    // A review the agent opened this turn must exist before the turn is recorded, so the turn lands in it.
    await this.readReviewRequest();
    await this.check();
    this.agentActive = false;
    await this.commit("agent", { label: this.turnLabel, thread: this.turnThread });
    const start = this.turnStart;
    this.turnStart = undefined;
    this.changedInTurn = start
      ? await this.serial(async () =>
          lines(await git(this.dir, ["diff", "--name-only", start, await this.workingTree()])),
        ).catch(() => [])
      : [];
  }

  /** The files the last agent turn changed, added or removed, workspace-relative with forward slashes. */
  get turnFiles(): string[] {
    return this.changedInTurn;
  }

  /** The working tree as a git tree object, whether or not it is committed; the index ends up holding it. */
  private async workingTree(): Promise<string> {
    await git(this.dir, ["add", "-A"]);
    return (await git(this.dir, ["write-tree"])).trim();
  }

  async revert(historyId: string): Promise<void> {
    // History stays put while a review is open; the review has its own iterations.
    if (this.reviews.state) return;
    const entry = this.history.find((item) => item.id === historyId);
    if (!entry) throw new Error(`Unknown history entry ${historyId}`);
    await this.serial(() => git(this.dir, ["restore", `--source=${entry.id}`, "--staged", "--worktree", "--", "."]));
    await this.reload();
    await this.check();
    await this.commit("revert", { label: entry.label ?? describeSource(entry.source), restoredFrom: entry.id });
  }

  /** Approves the open review: everything it changed becomes one history entry. */
  async approveReview(): Promise<void> {
    await this.serial(async () => {
      const review = this.reviews.state;
      if (!review) return;
      await this.commitNow("review", { label: review.title });
      await this.endReview();
    });
  }

  /** Discards the open review: the workspace goes back to where the review started. */
  async discardReview(): Promise<void> {
    await this.serial(async () => {
      const review = this.reviews.state;
      if (!review) return;
      await this.reviews.restore(review.baseline);
      await this.endReview();
    });
    await this.reload();
    await this.check();
  }

  /** Goes back to an earlier iteration; recorded as a new iteration, so nothing is lost. */
  async reviewStep(stepId: string): Promise<void> {
    await this.serial(async () => {
      const steps = this.reviews.state?.steps ?? [];
      const index = steps.findIndex((step) => step.id === stepId);
      if (index === -1 || index === steps.length - 1) return;
      await this.reviews.restore(stepId);
      await this.recordStep(`Back to iteration ${index + 1}`);
    });
    await this.reload();
    await this.check();
  }

  /**
   * Starts a set of alternatives for `prompt`: records hand edits first, then
   * notes where every take starts (the open review's latest iteration, or the
   * last history entry, which a review opened by the first take starts from).
   */
  async beginAlternatives(prompt: string, count: number): Promise<void> {
    await this.commit("external", {});
    await this.serial(async () => {
      const start = this.reviews.tip ?? (await git(this.dir, ["rev-parse", "HEAD"])).trim();
      this.pendingAlternatives = { prompt, start, count };
    });
  }

  /**
   * Records the take just made as alternative `label`. Returns false when there
   * is no review to hold the set (the first take did not open one, or it was
   * discarded), which ends the set.
   */
  async alternativeDone(label: string): Promise<boolean> {
    return this.serial(async () => {
      const review = this.reviews.state;
      const pending = this.pendingAlternatives;
      const tip = this.reviews.tip;
      if (!review || !pending || !tip) return false;
      const set = review.alternatives ?? { ...pending, options: [], done: false };
      await this.reviews.setAlternatives({ ...set, options: [...set.options, { label, step: tip }] });
      this.emit("review", this.reviews.state);
      return true;
    });
  }

  /** Puts the workspace back where the set started, for the next take; going back is not an iteration. */
  async nextAlternative(): Promise<void> {
    const start = this.pendingAlternatives?.start;
    if (!start || !this.reviews.state) return;
    await this.serial(() => this.reviews.restore(start, true));
    await this.reload();
    await this.check();
  }

  /** Ends making the set; with fewer than two takes there is nothing to choose between. */
  async endAlternatives(): Promise<void> {
    this.pendingAlternatives = undefined;
    await this.serial(async () => {
      const set = this.reviews.state?.alternatives;
      if (!set) return;
      await this.reviews.setAlternatives(
        set.options.length > 1 ? { ...set, count: set.options.length, done: true } : undefined,
      );
      this.emit("review", this.reviews.state);
    });
  }

  /** Continues with one alternative: the workspace becomes that take (a new iteration, unless it already is). */
  async chooseAlternative(label: string): Promise<void> {
    await this.serial(async () => {
      const set = this.reviews.state?.alternatives;
      const option = set?.done ? set.options.find((item) => item.label === label) : undefined;
      if (!option) return;
      if (option.step !== this.reviews.tip) {
        await this.reviews.restore(option.step);
        await this.recordStep(`Chose alternative ${label}`);
      }
      await this.reviews.setAlternatives(undefined);
      this.emit("review", this.reviews.state);
    });
    await this.reload();
    await this.check();
  }

  /** A past version for a review: its tokens, and a read-only copy of its source the preview can import. */
  baseline(historyId: string): Promise<{ id: string; design: Design; dir: string } | null> {
    return this.snapshots.get(historyId);
  }

  /** A past version for read-only inspection: its tokens, plus how its component code differs from now. */
  async snapshot(historyId: string): Promise<Snapshot | null> {
    if (!this.history.some((item) => item.id === historyId)) return null;
    try {
      const result = parseDesignText(await git(this.dir, ["show", `${historyId}:${DESIGN_FILE}`]));
      if (!result.ok) return null;
      const files = lines(await git(this.dir, ["diff", "--name-only", historyId, "--", ...SOURCE_DIRS]));
      let codeDiff = files.length
        ? await git(this.dir, ["diff", "--no-color", "-R", historyId, "--", ...SOURCE_DIRS])
        : "";
      if (codeDiff.length > DIFF_LIMIT) codeDiff = `${codeDiff.slice(0, DIFF_LIMIT)}\n… diff truncated`;
      return { id: historyId, design: result.design, files, codeDiff };
    } catch {
      return null;
    }
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

  /** Type-checks the source folders against the gallery contracts, and looks for colours that ignore the theme. */
  async check(): Promise<string[]> {
    const [errors, colorFindings] = await Promise.all([
      (this.options.typecheck ?? typecheck)(this.dir).catch((error: Error) => [error.message]),
      this.findFixedColors(),
    ]);
    const next = errors.length ? errors.slice(0, 50) : null;
    if (
      JSON.stringify(next) !== JSON.stringify(this.typeErrors) ||
      JSON.stringify(colorFindings) !== JSON.stringify(this.colorFindings)
    ) {
      this.typeErrors = next;
      this.colorFindings = colorFindings;
      this.emit("design", this.state);
    }
    return errors;
  }

  private async findFixedColors(): Promise<string[]> {
    const stylesheets: { file: string; css: string }[] = [];
    for (const dir of SOURCE_DIRS) {
      const names = await readdir(path.join(this.dir, dir)).catch(() => [] as string[]);
      for (const name of names.filter((item) => item.endsWith(".css")).sort()) {
        const css = await readFile(path.join(this.dir, dir, name), "utf8").catch(() => "");
        stylesheets.push({ file: `${dir}/${name}`, css });
      }
    }
    return fixedColorFindings(this.design, stylesheets);
  }

  private onFsEvent(filename: string | Buffer | null): void {
    const name = String(filename ?? "")
      .split(path.sep)
      .join("/");
    if (!name || name.startsWith(".git") || name.startsWith(".basis") || name.includes("node_modules")) return;
    if (name === REVIEW_FILE) {
      clearTimeout(this.reviewTimer);
      this.reviewTimer = setTimeout(() => !this.closed && void this.readReviewRequest(), 120);
      return;
    }
    if (name === DESIGN_FILE) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => !this.closed && void this.reload(), 60);
    }
    if (name !== DESIGN_FILE && !isSourcePath(name)) return;
    // Hand edits are checked and recorded once things settle; agent turns are handled by endTurn().
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.agentActive || this.closed) return;
      this.settling = (async () => {
        await this.check();
        // A turn that started meanwhile records the hand edit itself (beginTurn), and its own changes with it.
        if (!this.closed && !this.agentActive) await this.commit("external", {});
      })();
    }, 900);
  }

  /** Reads the agent's review.json: opens a review, updates the open one, or reports what is wrong with it. */
  private async readReviewRequest(): Promise<void> {
    // Read and applied in one step of the queue: a request read before an approve or discard that ran meanwhile
    // would otherwise open the review again once they end it.
    await this.serial(async () => {
      const before = JSON.stringify(this.reviews.errors);
      const request = await this.reviews.readRequest();
      if (JSON.stringify(this.reviews.errors) !== before) this.emit("design", this.state);
      if (request && (await this.reviews.apply(request))) this.emit("review", this.reviews.state);
    });
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
      this.reviews.state ? this.recordStep(meta.label ?? describeSource(source)) : this.commitNow(source, meta),
    );
  }

  private async commitNow(source: Source, meta: EntryMeta): Promise<void> {
    if (!(await commitToHistory(this.dir, source, meta, this.design.name))) return;
    this.history = await loadHistory(this.dir);
    this.emit("history", this.history);
  }

  private async recordStep(label: string): Promise<void> {
    if (!(await this.reviews.recordStep(label))) return;
    // Which sections the review's changes can reach, for the "also changed" check (see reach.ts).
    const review = this.reviews.state;
    if (review) {
      const before = parseDesignText(
        await git(this.dir, ["show", `${review.baseline}:${DESIGN_FILE}`]).catch(() => ""),
      );
      const reach = before.ok
        ? await reachedSpecimens(this.dir, review.files, before.design, this.design).catch(() => null)
        : null;
      await this.reviews.setReach(reach);
    }
    this.emit("review", this.reviews.state);
  }

  private async endReview(): Promise<void> {
    await this.reviews.end();
    this.emit("review", null);
    this.emit("design", this.state);
    // The copies stay until the next start (see init): the preview server remembers files it saw removed, so a
    // copy written again at the same path would not load.
  }
}

function serialize(design: Design): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}
