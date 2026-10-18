import { chromium, type Browser, type BrowserContextOptions, type LaunchOptions, type Page } from "playwright-core";
import { READY_ATTRIBUTE, shotFile, type CaptureShot, type CaptureView } from "../shared/capture.ts";

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

/** Opens a capture page URL and waits until it has settled (see `markReady` in src/capture/main.tsx). */
export async function openCapturePage(page: Page, url: string, timeout = 60_000): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(`html[${READY_ATTRIBUTE}]`, { state: "attached", timeout });
}

/** Opens one shot's page at the shot's size and photographs it; `failed` when what it renders threw. */
export async function takeShot(
  page: Page,
  url: string,
  shot: CaptureShot,
  timeout?: number,
): Promise<{ png: Buffer; failed: boolean }> {
  await page.setViewportSize({ width: shot.width, height: shot.viewportHeight });
  await openCapturePage(page, url, timeout);
  const failed = await page.evaluate(() => document.documentElement.hasAttribute("data-basis-error"));
  const png = await page.screenshot({ fullPage: shot.fullPage, animations: "disabled", caret: "hide" });
  return { png, failed };
}

/**
 * Captures every shot of every view the capture page at `pageUrl` lists. `pageUrl` is the page without a query
 * (".../capture.html" on the preview server, ".../index.html" in the kit's copy of the design).
 */
export async function captureViews(
  pageUrl: string,
  browser: Browser,
  onProgress?: (done: number, total: number) => void,
): Promise<CaptureResult> {
  const context = await browser.newContext(CAPTURE_CONTEXT);
  try {
    const page = await context.newPage();
    await openCapturePage(page, `${pageUrl}?list`);
    const listed = await page.evaluate(() => window.__basisCapture);
    const views = listed?.views ?? [];
    const problems = listed?.problems ?? [];
    const total = views.reduce((sum, view) => sum + view.screens.reduce((count, s) => count + s.shots.length, 0), 0);
    const shots: Shot[] = [];
    for (const view of views) {
      for (const screen of view.screens) {
        for (const shot of screen.shots) {
          const url = `${pageUrl}?view=${encodeURIComponent(view.id)}&screen=${encodeURIComponent(screen.id)}&theme=${shot.theme}`;
          const first = await takeShot(page, url, shot);
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
