import type { ProjectEntry, ProjectStatus } from "../shared/protocol.ts";

/**
 * How long a project nobody shows stays open once its agent has nothing to do: long enough to go and look at
 * another project and come back, short enough that a dozen projects visited in a day do not each keep an agent,
 * a Vite server and a browser running.
 */
export const IDLE_CLOSE_MS = 10 * 60_000;

/** What OpenProjects needs of an open project (OpenProject in server/project.ts). */
export interface Openable {
  readonly entry: ProjectEntry;
  /** The agent runs a turn, its fix-ups or the prompts queued behind it. */
  readonly busy: boolean;
  /** The agent waits for the user to answer a permission request. */
  readonly waiting: boolean;
  close(): Promise<void>;
}

export interface OpenProjectsOptions {
  idleMs?: number;
  /** Called with every project's status (see statuses) whenever one changes. */
  onStatus?: (status: Record<string, ProjectStatus>) => void;
}

/**
 * The projects open at once. Every tab (a viewer) shows one of them; the rest go on in the background, their agents
 * included, and one nobody shows closes once its agent has been idle for `idleMs`. Each open project holds a slot,
 * the lowest number free when it opened, which decides its preview port and Vite cache (OpenProject).
 */
export class OpenProjects<P extends Openable, Viewer> {
  private readonly projects = new Map<string, P>();
  private readonly opening = new Map<string, Promise<P>>();
  /** Slots of the projects open or being opened. */
  private readonly slots = new Map<string, number>();
  private readonly shown = new Map<Viewer, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Projects whose agent was busy at the last update. */
  private readonly busy = new Set<string>();
  /** Projects whose turn ended while nobody showed them, until a viewer does; kept when they close. */
  private readonly done = new Set<string>();
  private reported = "{}";

  constructor(
    private readonly openProject: (entry: ProjectEntry, slot: number) => Promise<P>,
    private readonly options: OpenProjectsOptions = {},
  ) {}

  get(id: string): P | undefined {
    return this.projects.get(id);
  }

  get all(): P[] {
    return [...this.projects.values()];
  }

  /** The project a viewer shows, if it is open. */
  shownBy(viewer: Viewer): P | undefined {
    const id = this.shown.get(viewer);
    return id === undefined ? undefined : this.projects.get(id);
  }

  /** The viewers showing a project. */
  viewers(id: string): Viewer[] {
    return [...this.shown].filter(([, shown]) => shown === id).map(([viewer]) => viewer);
  }

  /** Opens a project unless it is open, once however many ask at the same time. */
  open(entry: ProjectEntry): Promise<P> {
    const known = this.projects.get(entry.id);
    if (known) return Promise.resolve(known);
    const pending = this.opening.get(entry.id);
    if (pending) return pending;
    const slot = this.freeSlot();
    this.slots.set(entry.id, slot);
    const opening = this.openProject(entry, slot).then(
      (project) => {
        this.opening.delete(entry.id);
        this.projects.set(entry.id, project);
        this.update(entry.id);
        return project;
      },
      (error: unknown) => {
        this.opening.delete(entry.id);
        this.slots.delete(entry.id);
        throw error;
      },
    );
    this.opening.set(entry.id, opening);
    return opening;
  }

  /** Whether a project is open or being opened. */
  isOpen(id: string): boolean {
    return this.projects.has(id) || this.opening.has(id);
  }

  /** Shows a project in a viewer, opening it if needed; the project the viewer showed before goes on in the background. */
  async show(viewer: Viewer, entry: ProjectEntry): Promise<P> {
    const project = await this.open(entry);
    const before = this.shown.get(viewer);
    this.shown.set(viewer, entry.id);
    this.done.delete(entry.id);
    if (before !== undefined && before !== entry.id) this.update(before);
    this.update(entry.id);
    return project;
  }

  /** A viewer went away (its tab closed or reloaded). */
  hide(viewer: Viewer): void {
    const id = this.shown.get(viewer);
    this.shown.delete(viewer);
    if (id !== undefined) this.update(id);
  }

  /**
   * Takes in a project's state; call it whenever its agent's state or chat changes. It notes a turn that ended
   * while nobody looked, starts or stops the idle timer, and reports the statuses when they changed.
   */
  update(id: string): void {
    const project = this.projects.get(id);
    if (project) {
      const seen = this.viewers(id).length > 0;
      if (this.busy.has(id) && !project.busy && !seen) this.done.add(id);
      if (project.busy) this.busy.add(id);
      else this.busy.delete(id);
      this.schedule(id, !seen && !project.busy && !project.waiting);
    }
    const status = JSON.stringify(this.statuses());
    if (status === this.reported) return;
    this.reported = status;
    this.options.onStatus?.(this.statuses());
  }

  /** Every project's status that has one: an agent waiting for an answer, working, or done while unseen. */
  statuses(): Record<string, ProjectStatus> {
    const status: Record<string, ProjectStatus> = {};
    for (const id of this.done) status[id] = "done";
    for (const [id, project] of this.projects) {
      if (project.waiting) status[id] = "waiting";
      else if (project.busy) status[id] = "working";
    }
    return status;
  }

  /** Closes a project now, say when it is removed from the list, and forgets that it was done. */
  async close(id: string): Promise<void> {
    this.done.delete(id);
    await this.shut(id);
  }

  /** Closes every project (Basis stops). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.projects.keys()].map((id) => this.shut(id)));
  }

  private async shut(id: string): Promise<void> {
    const project = this.projects.get(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (!project) return;
    this.projects.delete(id);
    this.busy.delete(id);
    for (const [viewer, shown] of this.shown) if (shown === id) this.shown.delete(viewer);
    try {
      await project.close();
    } finally {
      // The slot is free only once the project's preview port is.
      this.slots.delete(id);
      this.update(id);
    }
  }

  private schedule(id: string, idle: boolean): void {
    const timer = this.timers.get(id);
    if (!idle) {
      clearTimeout(timer);
      this.timers.delete(id);
      return;
    }
    if (timer) return;
    const next = setTimeout(() => {
      this.timers.delete(id);
      const project = this.projects.get(id);
      // Checked again: a viewer or a turn may have come along since.
      if (!project || this.viewers(id).length || project.busy || project.waiting) return;
      console.log(`[basis] closing ${project.entry.name}, idle in the background`);
      void this.shut(id).catch((error: unknown) => console.error("[basis]", error));
    }, this.options.idleMs ?? IDLE_CLOSE_MS);
    // An idle project must not keep Basis from exiting.
    next.unref();
    this.timers.set(id, next);
  }

  private freeSlot(): number {
    const taken = new Set(this.slots.values());
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    return slot;
  }
}
