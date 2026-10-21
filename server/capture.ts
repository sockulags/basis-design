import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
  type Request,
} from "playwright-core";
import { listQuery, READY_ATTRIBUTE, shotFile, type CaptureShot, type CaptureView } from "../shared/capture.ts";
import { boxesExpression, MEDIA_SELECTOR, type Boxes } from "./verify-kit/compare.mjs";

/*
 * Taking the verification kit's screenshots: a headless browser opens each screen of each view on the capture
 * page (capture.html) at the size its shots ask for. Everything that could make two runs differ is fixed: the
 * device scale, the colour profile, text antialiasing, reduced motion. Each shot is taken twice, and a screen
 * whose two images differ is reported as unstable, since nothing could ever match it pixel for pixel.
 */

/** Chromium flags that keep rendering the same between runs and machines of one platform. */
export const CAPTURE_ARGS = [
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--hide-scrollbars",
];

export interface CaptureBrowser {
  browser: Browser;
  name: string;
  version: string;
}

/**
 * Playwright's own Chromium when it is installed (`npx playwright install chromium`): the same build on every
 * machine, which is what comparing screenshots wants. Otherwise the Chrome or Edge already on this computer.
 */
export async function launchCaptureBrowser(): Promise<CaptureBrowser> {
  const candidates: { name: string; options: LaunchOptions }[] = [
    { name: "Playwright Chromium", options: {} },
    { name: "Google Chrome", options: { channel: "chrome" } },
    { name: "Microsoft Edge", options: { channel: "msedge" } },
  ];
  for (const { name, options } of candidates) {
    try {
      const browser = await chromium.launch({ ...options, headless: true, args: CAPTURE_ARGS });
      return { browser, name, version: browser.version() };
    } catch {
      // Not installed; try the next one.
    }
  }
  throw new Error(
    "No browser to take the screenshots with. Install Google Chrome or Microsoft Edge, or run `npx playwright install chromium`.",
  );
}

export interface Shot extends CaptureShot {
  view: string;
  screen: string;
  file: string;
  png: Buffer;
  /** The image's height in pixels: the page's height for full-page shots. */
  imageHeight: number;
  /** False when two captures of the shot differed, so the screen does not render the same every time. */
  stable: boolean;
  /** Set when the screen threw while rendering. */
  failed: boolean;
  /** The boxes of the elements marked as media (`MEDIA_SELECTOR`), which the kit's comparison leaves out. */
  boxes: Boxes;
  /** Images and media the screen loads from other sites (`remoteMedia`). */
  remote: string[];
}

export interface CaptureResult {
  views: CaptureView[];
  problems: string[];
  shots: Shot[];
}

/** The height stored in a PNG's IHDR chunk. */
export function pngHeight(png: Buffer): number {
  return png.length >= 24 ? png.readUInt32BE(20) : 0;
}

/** The browser context every capture runs in: device scale 1, reduced motion, light as the system's scheme. */
export const CAPTURE_CONTEXT: BrowserContextOptions = {
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "light",
  viewport: { width: 1440, height: 900 },
};

/**
 * Whether a request the page makes is for an image or media from another site: what a placeholder in the view's
 * own folder should replace, since such a file can change, vanish or need a login before the implementation is
 * compared with the design. Fonts and stylesheets are not media.
 */
export function isRemoteMedia(resourceType: string, url: string, pageOrigin: string): boolean {
  if (resourceType !== "image" && resourceType !== "media") return false;
  try {
    const target = new URL(url);
    return (target.protocol === "http:" || target.protocol === "https:") && target.origin !== pageOrigin;
  } catch {
    return false;
  }
}

/** Opens a capture page URL and waits until it has settled (see `markReady` in src/capture/main.tsx). */
export async function openCapturePage(page: Page, url: string, timeout = 60_000): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(`html[${READY_ATTRIBUTE}]`, { state: "attached", timeout });
  // Ready says the page is rendered, not that it is painted: wait for its fonts and two frames, as the product's
  // side waits until it settles, so a screenshot never catches the page before its first paint.
  await page.evaluate(`document.fonts.ready.then(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
}

/**
 * Opens one shot's page at the shot's size and photographs it; `failed` when what it renders threw. A full-page
 * shot of a page taller than `maxHeight` shows only its top `maxHeight` pixels; `pageHeight` is the whole page's.
 * `remote` lists the images and media it loaded from other sites.
 */
export async function takeShot(
  page: Page,
  url: string,
  shot: CaptureShot,
  timeout?: number,
  maxHeight?: number,
): Promise<{ png: Buffer; failed: boolean; pageHeight: number; remote: string[] }> {
  const origin = new URL(url).origin;
  const remote = new Set<string>();
  const onRequest = (request: Request) => {
    if (isRemoteMedia(request.resourceType(), request.url(), origin)) remote.add(request.url());
  };
  page.on("request", onRequest);
  try {
    await page.setViewportSize({ width: shot.width, height: shot.viewportHeight });
    await openCapturePage(page, url, timeout);
    const { failed, height } = await page.evaluate(() => ({
      failed: document.documentElement.hasAttribute("data-basis-error"),
      height: document.documentElement.scrollHeight,
    }));
    const pageHeight = shot.fullPage ? Math.max(height, shot.viewportHeight) : shot.viewportHeight;
    const cut = shot.fullPage && maxHeight !== undefined && pageHeight > maxHeight;
    const png = await page.screenshot({
      fullPage: shot.fullPage,
      ...(cut ? { clip: { x: 0, y: 0, width: shot.width, height: maxHeight } } : {}),
      animations: "disabled",
      caret: "hide",
    });
    return { png, failed, pageHeight, remote: [...remote].sort() };
  } finally {
    page.off("request", onRequest);
  }
}

/**
 * Captures every shot of every view the capture page at `pageUrl` lists. `pageUrl` is the page without a query
 * (".../capture.html" on the preview server, ".../index.html" in the kit's copy of the design). `widths` are the
 * project's, for flows without capture widths of their own. With `only`, just the views with those ids.
 */
export async function captureViews(
  pageUrl: string,
  browser: Browser,
  widths: number[],
  onProgress?: (done: number, total: number) => void,
  only?: string[],
): Promise<CaptureResult> {
  const context = await browser.newContext(CAPTURE_CONTEXT);
  try {
    const page = await context.newPage();
    await openCapturePage(page, `${pageUrl}${listQuery(widths)}`);
    const listed = await page.evaluate(() => window.__basisCapture);
    const views = (listed?.views ?? []).filter((view) => !only || only.includes(view.id));
    const problems = listed?.problems ?? [];
    const total = views.reduce((sum, view) => sum + view.screens.reduce((count, s) => count + s.shots.length, 0), 0);
    const shots: Shot[] = [];
    for (const view of views) {
      for (const screen of view.screens) {
        for (const shot of screen.shots) {
          const url = `${pageUrl}?view=${encodeURIComponent(view.id)}&screen=${encodeURIComponent(screen.id)}&theme=${shot.theme}`;
          const first = await takeShot(page, url, shot);
          const boxes = (await page.evaluate(boxesExpression([MEDIA_SELECTOR]))) as Boxes;
          const second = await takeShot(page, url, shot);
          shots.push({
            ...shot,
            view: view.id,
            screen: screen.id,
            file: shotFile(view.id, screen.id, shot),
            png: first.png,
            imageHeight: pngHeight(first.png),
            stable: first.png.equals(second.png),
            failed: first.failed,
            boxes,
            remote: first.remote,
          });
          onProgress?.(shots.length, total);
        }
      }
    }
    return { views, problems, shots };
  } finally {
    await context.close();
  }
}
