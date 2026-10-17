import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseReviewRequest,
  REVIEW_FILE,
  type Alternatives,
  type ReviewRequest,
  type ReviewState,
} from "../shared/review.ts";
import { git, isCommit, lines } from "./exec.ts";
import { SOURCE_DIRS } from "./paths.ts";

/** Where an open review keeps its iterations: a ref outside branches, so history (main) never shows them. */
const REVIEW_REF = "refs/basis/review";
/** The open review's state, kept in .basis/ so it survives restarts. */
const STATE_FILE = "review.json";

/**
 * The open review of a workspace: the request the agent wrote, the commit it
 * started from and its iterations. The methods run git and expect the caller
 * to serialise them with its other git work (see Workspace.serial).
 */
export class Reviews {
  /** The open review, or null. */
  state: ReviewState | null = null;
  /** Problems with review.json, or null when it is valid or absent. */
  errors: string[] | null = null;
  private readonly stateFile: string;
  /**
   * What the next iteration builds on when it is not the latest one: the
   * starting point of a set of alternatives, after the workspace went back to it.
   */
  private nextParent: string | undefined;

  constructor(private readonly dir: string) {
    this.stateFile = path.join(dir, ".basis", STATE_FILE);
  }

  /** Restores the review that was open when Basis last stopped, if its commits still exist. */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, "utf8")) as ReviewState;
      const valid =
        typeof raw.title === "string" &&
        Array.isArray(raw.show) &&
        Array.isArray(raw.steps) &&
        (await isCommit(this.dir, raw.baseline)) &&
        (await Promise.all(raw.steps.map((step) => isCommit(this.dir, step.id)))).every(Boolean);
      this.state = valid ? { ...raw, files: Array.isArray(raw.files) ? raw.files : [] } : null;
      // Alternatives still being made when Basis stopped are not coming; finished ones still wait for a pick.
      if (this.state?.alternatives && !this.state.alternatives.done)
        this.state = { ...this.state, alternatives: undefined };
    } catch {
      this.state = null;
    }
  }

  /** Reads the agent's review.json; sets `errors` and returns the request when it is valid. */
  async readRequest(): Promise<ReviewRequest | null> {
    let text: string;
    try {
      text = await readFile(path.join(this.dir, REVIEW_FILE), "utf8");
    } catch {
      // No request (or the agent removed it): an open review stays open until approved or discarded.
      this.errors = null;
      return null;
    }
    const result = parseReviewRequest(text);
    this.errors = result.ok ? null : result.errors;
    return result.ok ? result.request : null;
  }

  /**
   * Opens a review for the request, or updates what the open one shows.
   * A new review starts from HEAD: during a turn, the state before the turn.
   * Returns whether anything changed.
   */
  async apply(request: ReviewRequest): Promise<boolean> {
    const current = this.state;
    if (current && current.title === request.title && JSON.stringify(current.show) === JSON.stringify(request.show))
      return false;
    const baseline = current?.baseline ?? (await git(this.dir, ["rev-parse", "HEAD"])).trim();
    this.state = current
      ? { ...current, title: request.title, show: request.show }
      : { ...request, baseline, startedAt: Date.now(), steps: [], files: [] };
    await this.save();
    return true;
  }

  /** The commit the working tree is recorded against: the latest iteration, or what the workspace went back to. */
  get tip(): string | undefined {
    const review = this.state;
    return review ? (this.nextParent ?? review.steps.at(-1)?.id ?? review.baseline) : undefined;
  }

  /**
   * Records the working tree as the next iteration, if it changed. Returns
   * whether it did. A new iteration after a finished set of alternatives means
   * the user moved on, so the set is put away (its iterations stay).
   */
  async recordStep(label: string): Promise<boolean> {
    const review = this.state;
    const parent = this.tip;
    if (!review || !parent) return false;
    await git(this.dir, ["add", "-A"]);
    const tree = (await git(this.dir, ["write-tree"])).trim();
    if (tree === (await git(this.dir, ["rev-parse", `${parent}^{tree}`])).trim()) return false;
    const id = (await git(this.dir, ["commit-tree", tree, "-p", parent, "-m", `review: ${label.slice(0, 72)}`])).trim();
    this.nextParent = undefined;
    await git(this.dir, ["update-ref", REVIEW_REF, id]);
    const files = lines(await git(this.dir, ["diff", "--name-only", review.baseline, id, "--", ...SOURCE_DIRS]));
    const alternatives = review.alternatives?.done ? undefined : review.alternatives;
    this.state = { ...review, steps: [...review.steps, { id, at: Date.now(), label }], files, alternatives };
    await this.save();
    return true;
  }

  /** Sets or clears the review's alternatives. */
  async setAlternatives(alternatives: Alternatives | undefined): Promise<void> {
    if (!this.state) return;
    this.state = { ...this.state, alternatives };
    await this.save();
  }

  /** Records which specimens the review's changes can reach (null: all of them). */
  async setReach(reach: string[] | null): Promise<void> {
    if (!this.state) return;
    this.state = { ...this.state, reach };
    await this.save();
  }

  /**
   * Puts the working tree back to a commit: the starting point, or one of the
   * iterations. With `asBase`, the next iteration builds on that commit rather
   * than on the latest one, and going back is not an iteration of its own.
   */
  async restore(commit: string, asBase = false): Promise<void> {
    await git(this.dir, ["add", "-A"]);
    await git(this.dir, ["restore", `--source=${commit}`, "--staged", "--worktree", "--", "."]);
    if (asBase) this.nextParent = commit;
  }

  /** Forgets the open review: its iterations ref, its saved state and the agent's request. */
  async end(): Promise<void> {
    this.state = null;
    this.nextParent = undefined;
    this.errors = null;
    await git(this.dir, ["update-ref", "-d", REVIEW_REF]).catch(() => undefined);
    await rm(this.stateFile, { force: true });
    await rm(path.join(this.dir, REVIEW_FILE), { force: true });
  }

  private async save(): Promise<void> {
    await writeFile(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`);
  }
}
