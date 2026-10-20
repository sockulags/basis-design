import type { BrowserContext, Page } from "playwright-core";
import {
  captureShots,
  DEFAULT_CAPTURE_WIDTHS,
  listQuery,
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

/**
 * What to photograph: a specimen by id (a component's, a pattern's or a view's), one screen of a view, or an id
 * that may be either (`{ id }`): a view's id photographs a screen of it, any other id a specimen.
 */
export type ShotTarget = { specimen: string } | { view: string; screen?: string } | { id: string; screen?: string };

export interface ShotOptions extends CaptureOptions {
  /** Without given widths, only the narrowest of the widths the target would get. */
  narrowest?: boolean;
  /** At most this many shots; a plan with more is refused, saying what to leave out. */
  maxShots?: number;
  /** Full-page shots of pages taller than this are cut at it (`Screenshot.cut`). */
  maxHeight?: number;
}

export interface Screenshot extends CaptureShot {
  png: Buffer;
  /** The image's height in pixels: the page's height for full-page shots, unless it was cut. */
  imageHeight: number;
  /** The page's whole height, which is more than the image's when it was cut at `maxHeight`. */
  pageHeight: number;
  cut: boolean;
  /** Set when what the page renders threw. */
  failed: boolean;
}

/** The capture page's query for one target, theme left out, and the shots to take of it. */
export interface CapturePlan {
  query: Record<string, string>;
  shots: CaptureShot[];
  /** For a view screen: the view's screens, so a caller can say which others there are. */
  screens?: { id: string; label: string }[];
}

/**
 * Resolves a target against what the capture page lists and works out its shots. A specimen gets the defaults
 * of a flow without capture options (the project's widths the list was made with); a view screen starts from what
 * its flow block asks for. Given widths,
 * themes or height replace those. Throws with the ids there are when the target is not among them.
 */
export function planCapture(list: CaptureList, target: ShotTarget, options: ShotOptions = {}): CapturePlan {
  const given: CaptureOptions = {
    ...(options.widths?.length ? { widths: options.widths } : {}),
    ...(options.themes?.length ? { themes: options.themes } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
  };
  const limit = (plan: CapturePlan): CapturePlan => {
    let shots = plan.shots;
    if (options.narrowest && !given.widths?.length) {
      const narrowest = Math.min(...shots.map((shot) => shot.width));
      shots = shots.filter((shot) => shot.width === narrowest);
    }
    const max = options.maxShots;
    if (max !== undefined && shots.length > max) {
      const widths = new Set(shots.map((shot) => shot.width)).size;
      const themes = new Set(shots.map((shot) => shot.theme)).size;
      throw new Error(
        `That is ${shots.length} images (${widths} widths in ${themes} themes); at most ${max} per call. Ask for fewer widths or one theme, and look at the rest in another call.`,
      );
    }
    return { ...plan, shots };
  };
  if ("id" in target) {
    // Titles and labels work too, as review.json names specimens and screens by them.
    const named = (wanted: string) => (item: { id: string; title?: string; label?: string }) =>
      item.id === wanted || [item.title, item.label].some((name) => name?.toLowerCase() === wanted.toLowerCase());
    const view = list.views.find(named(target.id));
    if (view) {
      const screen = target.screen ? view.screens.find(named(target.screen)) : undefined;
      return planCapture(list, { view: view.id, screen: screen?.id ?? target.screen }, options);
    }
    const specimen = list.specimens.find(named(target.id));
    if (!specimen) {
      const ids = (items: { id: string }[]) => items.map((item) => item.id).join(", ") || "none";
      throw new Error(
        `No specimen or view "${target.id}". Specimens: ${ids(list.specimens)}. Views: ${ids(list.views)}.`,
      );
    }
    if (target.screen) throw new Error(`"${specimen.id}" is not a view, so it has no screens.`);
    return planCapture(list, { specimen: specimen.id }, options);
  }
  if ("specimen" in target) {
    if (!list.specimens.some((specimen) => specimen.id === target.specimen)) {
      throw new Error(
        `No specimen "${target.specimen}". There are: ${list.specimens.map((specimen) => specimen.id).join(", ") || "none"}.`,
      );
    }
    return limit({ query: { specimen: target.specimen }, shots: captureShots(given, list.widths) });
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
  return limit({
    query: { view: view.id, screen: screen.id },
    shots: captureShots({ ...asked, ...given }),
    screens: view.screens.map(({ id, label }) => ({ id, label })),
  });
}

/** One screen of a view photographed twice (`Screenshots.repeat`). */
export interface RepeatedShot {
  view: { id: string; title: string; file: string };
  screen: { id: string; label: string };
  shot: CaptureShot;
  first: Buffer;
  /** Taken with the clock moved on; the first image again when the screen failed. */
  second: Buffer;
  /** What the screen threw while rendering, or null when it rendered. */
  error: string | null;
  /** Images and media the screen loads from other sites (`isRemoteMedia` in server/capture.ts). */
  remote: string[];
}

/** How far `Screenshots.repeat` moves the clock for the second image: a day, an hour, a minute, a second and a bit. */
export const CLOCK_SHIFT_MS = ((24 * 60 + 61) * 60 + 1) * 1000 + 1;

/**
 * A script for the page to run before its own: `Date` keeps running, `shift` ms ahead. A proxy rather than a
 * subclass, so `Date()` without `new` and `instanceof Date` still work. A string rather than a function, since the
 * TypeScript loader may add helpers to a function's source that the page does not have.
 */
export function shiftClockScript(shift: number): string {
  return `(() => {
  const RealDate = Date;
  const now = () => RealDate.now() + ${Math.round(shift)};
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)),
  });
})();`;
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
  /** The project's widths, narrowest first: what a flow without its own capture widths, or a specimen, gets. */
  widths?: () => number[];
}

/** Screenshots from one preview server's capture page (`http://127.0.0.1:<preview port>/capture.html`). */
export class Screenshots {
  private readonly browser: Keeper<OpenBrowser>;
  private readonly timeoutMs: number;
  private readonly widths: () => number[];

  constructor(
    readonly pageUrl: string,
    {
      idleMs = 60_000,
      timeoutMs = 30_000,
      launch = launchCaptureBrowser,
      widths = () => DEFAULT_CAPTURE_WIDTHS,
    }: ScreenshotsOptions = {},
  ) {
    this.timeoutMs = timeoutMs;
    this.widths = widths;
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
  capture(target: ShotTarget, options: ShotOptions = {}): Promise<{ plan: CapturePlan; shots: Screenshot[] }> {
    return this.browser.use(async ({ context }) => {
      const page = await context.newPage();
      try {
        const plan = planCapture(await this.readList(page), target, options);
        const shots: Screenshot[] = [];
        for (const shot of plan.shots) {
          const { png, failed, pageHeight } = await this.settled(() =>
            takeShot(page, captureUrl(this.pageUrl, plan.query, shot.theme), shot, this.timeoutMs, options.maxHeight),
          );
          const imageHeight = pngHeight(png);
          shots.push({ ...shot, png, imageHeight, pageHeight, cut: imageHeight < pageHeight, failed });
        }
        return { plan, shots };
      } finally {
        await page.close();
      }
    });
  }

  /**
   * Photographs every screen of the views whose specimen file is among `files` twice, at the first shot its flow
   * asks for: once as usual, and once with the page's clock moved on by `CLOCK_SHIFT_MS`, so a screen that shows
   * the time or the date comes out different whatever it rounds to. For the check that views render the same
   * every time (server/stability.ts), which also reports the images the first one loaded from other sites.
   */
  repeat(files: string[]): Promise<RepeatedShot[]> {
    return this.browser.use(async ({ context }) => {
      const page = await context.newPage();
      // The shift is this page's own, so the agent's screenshots in the same context keep the real clock.
      const shifted = await context.newPage();
      try {
        await shifted.addInitScript({ content: shiftClockScript(CLOCK_SHIFT_MS) });
        const wanted = new Set(files);
        const views = (await this.readList(page)).views.filter((view) => wanted.has(view.file));
        const repeated: RepeatedShot[] = [];
        for (const view of views) {
          for (const screen of view.screens) {
            const shot = screen.shots[0];
            if (!shot) continue;
            const url = captureUrl(this.pageUrl, { view: view.id, screen: screen.id }, shot.theme);
            const first = await this.settled(() => takeShot(page, url, shot, this.timeoutMs));
            const error = first.failed
              ? (await page.locator(".capture-problem").first().textContent())?.replace(
                  /^This screen failed to render:\s*/,
                  "",
                )
              : null;
            const second = first.failed
              ? first
              : await this.settled(() => takeShot(shifted, url, shot, this.timeoutMs));
            repeated.push({
              view: { id: view.id, title: view.title, file: view.file },
              screen: { id: screen.id, label: screen.label },
              shot,
              first: first.png,
              second: second.png,
              error: first.failed ? (error ?? "it threw while rendering") : null,
              remote: first.remote,
            });
          }
        }
        return repeated;
      } finally {
        await page.close();
        await shifted.close();
      }
    });
  }

  /**
   * Runs `work` with a page of its own in the kept browser (the gallery for a project in the background,
   * server/background.ts), and closes the page when it is done; the browser stays open meanwhile.
   */
  withPage<R>(work: (page: Page) => Promise<R>): Promise<R> {
    return this.browser.use(async ({ context }) => {
      const page = await context.newPage();
      try {
        return await work(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  /** Closes the browser now, say when the project closes; a later call starts another. */
  close(): Promise<void> {
    return this.browser.close();
  }

  private async readList(page: Page): Promise<CaptureList> {
    const widths = this.widths();
    await this.settled(() => openCapturePage(page, `${this.pageUrl}${listQuery(widths)}`, this.timeoutMs));
    const listed = await page.evaluate(() => window.__basisCapture);
    return listed ?? { specimens: [], views: [], problems: [], widths };
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
