import type { BrowserContext, Page } from "playwright-core";
import {
  captureShots,
  type CaptureList,
  type CaptureOptions,
  type CaptureShot,
  type CaptureTheme,
} from "../shared/capture.ts";
import {
  CAPTURE_CONTEXT,
  launchCaptureBrowser,
  openCapturePage,
  pngHeight,
  takeShot,
  type CaptureBrowser,
} from "./capture.ts";

/*
 * Screenshots of the live design, for the agent and for Basis' own checks: one specimen alone, or one screen of a
 * view, taken from the open project's preview server at chosen widths and themes. They go through the
 * verification kit's capture page with its browser, flags and context, so they look like the kit's. One browser
 * stays open between calls, since starting one takes about a second, and closes after a minute without any.
 */

/** What to photograph: a specimen by id (a component's, a pattern's or a view's), or one screen of a view. */
export type ShotTarget = { specimen: string } | { view: string; screen?: string };

export interface Screenshot extends CaptureShot {
  png: Buffer;
  /** The image's height in pixels: the page's height for full-page shots. */
  imageHeight: number;
  /** Set when what the page renders threw. */
  failed: boolean;
}

/** The capture page's query for one target, theme left out, and the shots to take of it. */
export interface CapturePlan {
  query: Record<string, string>;
  shots: CaptureShot[];
}

/**
 * Resolves a target against what the capture page lists and works out its shots. A specimen gets the defaults
 * of a flow without capture options; a view screen starts from what its flow block asks for. Given widths,
 * themes or height replace those. Throws with the ids there are when the target is not among them.
 */
export function planCapture(list: CaptureList, target: ShotTarget, options: CaptureOptions = {}): CapturePlan {
  const given: CaptureOptions = {
    ...(options.widths?.length ? { widths: options.widths } : {}),
    ...(options.themes?.length ? { themes: options.themes } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
  };
  if ("specimen" in target) {
    if (!list.specimens.some((specimen) => specimen.id === target.specimen)) {
      throw new Error(
        `No specimen "${target.specimen}". There are: ${list.specimens.map((specimen) => specimen.id).join(", ") || "none"}.`,
      );
    }
    return { query: { specimen: target.specimen }, shots: captureShots(given) };
  }
  const view = list.views.find((item) => item.id === target.view);
  if (!view) {
    throw new Error(`No view "${target.view}". There are: ${list.views.map((item) => item.id).join(", ") || "none"}.`);
  }
  const screen = target.screen ? view.screens.find((item) => item.id === target.screen) : view.screens[0];
  if (!screen) {
    throw new Error(
      `The view "${view.id}" has no screen "${target.screen}". Its screens are: ${view.screens.map((item) => item.id).join(", ")}.`,
    );
  }
  const first = screen.shots[0];
  const asked: CaptureOptions = {
    widths: [...new Set(screen.shots.map((shot) => shot.width))],
    themes: [...new Set(screen.shots.map((shot) => shot.theme))],
    height: !first || first.fullPage ? "full" : first.viewportHeight,
  };
  return { query: { view: view.id, screen: screen.id }, shots: captureShots({ ...asked, ...given }) };
}

/** The capture page's URL for a plan's query in one theme. */
export function captureUrl(pageUrl: string, query: Record<string, string>, theme: CaptureTheme): string {
  return `${pageUrl}?${new URLSearchParams({ ...query, theme })}`;
}

/**
 * Something expensive to open, kept open while it is used and closed once nothing has used it for `idleMs`.
 * Calls may overlap; the idle time counts from the end of the last one. Opening again after an error, or when
 * `alive` says the open one is gone.
 */
export class Keeper<T> {
  private opening: Promise<T> | null = null;
  private busy = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly open: () => Promise<T>,
    private readonly shut: (value: T) => Promise<void>,
    private readonly idleMs: number,
    private readonly alive: (value: T) => boolean = () => true,
  ) {}

  async use<R>(work: (value: T) => Promise<R>): Promise<R> {
    this.busy++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      let value = await this.get();
      if (!this.alive(value)) {
        this.opening = null;
        value = await this.get();
      }
      return await work(value);
    } finally {
      if (--this.busy === 0) {
        this.timer = setTimeout(() => void this.close(), this.idleMs);
        // An idle browser must not keep a script that is done from exiting.
        this.timer.unref();
      }
    }
  }

  /** Whether something is open (or being opened) now. */
  get isOpen(): boolean {
    return this.opening !== null;
  }

  /** Closes what is open now; the next `use` opens it again. */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const opening = this.opening;
    this.opening = null;
    if (!opening) return;
    const value = await opening.catch(() => null);
    if (value !== null) await this.shut(value).catch(() => undefined);
  }

  private get(): Promise<T> {
    if (!this.opening) {
      const opening = this.open();
      this.opening = opening;
      // A failed launch is not kept, so the next call tries again.
      opening.catch(() => {
        if (this.opening === opening) this.opening = null;
      });
    }
    return this.opening;
  }
}

interface OpenBrowser extends CaptureBrowser {
  context: BrowserContext;
}

export interface ScreenshotsOptions {
  /** How long the browser stays open after the last call. */
  idleMs?: number;
  /** How long a page may take to settle; a compile error in the preview means it never does. */
  timeoutMs?: number;
  launch?: () => Promise<CaptureBrowser>;
}

/** Screenshots from one preview server's capture page (`http://127.0.0.1:<preview port>/capture.html`). */
export class Screenshots {
  private readonly browser: Keeper<OpenBrowser>;
  private readonly timeoutMs: number;

  constructor(
    private readonly pageUrl: string,
    { idleMs = 60_000, timeoutMs = 30_000, launch = launchCaptureBrowser }: ScreenshotsOptions = {},
  ) {
    this.timeoutMs = timeoutMs;
    this.browser = new Keeper<OpenBrowser>(
      async () => {
        const opened = await launch();
        // One context for every call, so the preview's modules stay in its cache between them.
        return { ...opened, context: await opened.browser.newContext(CAPTURE_CONTEXT) };
      },
      (opened) => opened.browser.close(),
      idleMs,
      (opened) => opened.browser.isConnected(),
    );
  }

  /** Every specimen and view the preview has now, with each screen's shots. */
  list(): Promise<CaptureList> {
    return this.browser.use(async ({ context }) => {
      const page = await context.newPage();
      try {
        return await this.readList(page);
      } finally {
        await page.close();
      }
    });
  }

  /** Photographs a target at each width and theme (see planCapture): each theme in turn, narrowest width first. */
  capture(target: ShotTarget, options: CaptureOptions = {}): Promise<Screenshot[]> {
    return this.browser.use(async ({ context }) => {
      const page = await context.newPage();
      try {
        const { query, shots } = planCapture(await this.readList(page), target, options);
        const taken: Screenshot[] = [];
        for (const shot of shots) {
          const { png, failed } = await this.settled(() =>
            takeShot(page, captureUrl(this.pageUrl, query, shot.theme), shot, this.timeoutMs),
          );
          taken.push({ ...shot, png, imageHeight: pngHeight(png), failed });
        }
        return taken;
      } finally {
        await page.close();
      }
    });
  }

  /** Closes the browser now, say when the project closes; a later call starts another. */
  close(): Promise<void> {
    return this.browser.close();
  }

  private async readList(page: Page): Promise<CaptureList> {
    await this.settled(() => openCapturePage(page, `${this.pageUrl}?list`, this.timeoutMs));
    const listed = await page.evaluate(() => window.__basisCapture);
    return listed ?? { specimens: [], views: [], problems: [] };
  }

  /** Says what a timeout most likely means rather than Playwright's selector message. */
  private async settled<R>(work: () => Promise<R>): Promise<R> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `The capture page did not settle within ${this.timeoutMs / 1000} s. The preview may have a compile error.`,
        );
      }
      throw error;
    }
  }
}
