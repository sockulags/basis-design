import type { Page } from "playwright-core";
import { PAGES, type PageId, type PreviewView } from "../shared/frame.ts";

/*
 * The gallery of a project no tab shows. The fix loop learns of render errors and of the accessibility, contrast
 * and layout findings only from a gallery that reports them, and the chrome's tab shows another project. So while
 * that project's agent works, a headless page in the project's screenshot browser plays the chrome: it embeds the
 * gallery from the preview origin, as the chrome does (with its copy in the other theme), sends it the view, and
 * passes on what it reports, so the fix loop's wait for the gallery reloaded after a turn works as with a tab.
 */

/** What the background gallery reports, as a tab does with `preview-errors`. */
export interface BackgroundReport {
  errors: string[];
  checks: string[];
  checking: boolean;
  generation: number;
}

/** What the background page needs of the project's screenshots (server/screenshots.ts). */
export interface PageSource {
  withPage<R>(work: (page: Page) => Promise<R>): Promise<R>;
}

/** The page of the gallery that shows most of these files (workspace paths); the design system page without any. */
export function pageForFiles(files: string[]): PageId {
  let best: PageId = "system";
  let most = 0;
  for (const page of PAGES) {
    const count = files.filter((file) => file.startsWith(`${page.folder}/`)).length;
    if (count > most) [best, most] = [page.id, count];
  }
  return best;
}

/** A report from the page, checked: it comes from a page that runs the agent's code. */
export function parseReport(raw: unknown): BackgroundReport {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = (items: unknown) =>
    Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
  return {
    errors: strings(value.errors),
    checks: strings(value.checks),
    checking: value.checking === true,
    generation: Number.isSafeInteger(value.generation) ? Number(value.generation) : 0,
  };
}

/** Where the chrome server serves the host page (`?port=<preview port>`). */
export const BACKGROUND_PATH = "/background.html";

/**
 * The host page: the gallery of the preview on `?port` in a sandboxed frame, sent the view on every `ready` (a
 * fresh document, as after the reload at the end of a turn), and its errors and checks passed to Basis, starting
 * afresh with each document as the chrome's do. It is served by the chrome server, from loopback: a page the
 * browser made up itself (`page.route`) counts as public, and Chromium then refuses it frames from localhost.
 * Opened in a tab, it shows a gallery that cannot report anywhere.
 */
export const HOST_PAGE = `<!doctype html>
<html>
<body style="margin:0">
<iframe id="gallery" sandbox="allow-scripts allow-same-origin" style="border:0;width:100vw;height:100vh"></iframe>
<script>
const port = Number(new URLSearchParams(location.search).get("port"));
const origin = "http://localhost:" + port;
const frame = document.getElementById("gallery");
let state = { errors: [], checks: [], checking: true, generation: 0 };
window.addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow || event.origin !== origin) return;
  const message = event.data || {};
  if (message.type === "ready") {
    state = { errors: [], checks: [], checking: true, generation: message.generation };
    frame.contentWindow.postMessage({ type: "render", view: await window.basisView() }, origin);
  } else if (message.type === "errors") {
    state = { ...state, errors: message.errors };
  } else if (message.type === "checks") {
    state = { ...state, checks: message.checks, checking: message.running === true };
  } else {
    return;
  }
  window.basisReport(state);
});
if (Number.isInteger(port) && port > 0) frame.src = origin + "/preview.html?parent=" + encodeURIComponent(location.origin);
</script>
</body>
</html>
`;

/**
 * Runs the background gallery of one project while it is needed. `hostOrigin` is a chrome origin, which the
 * preview accepts as its parent and its CSP as a frame ancestor. `onReport` gets each report, and null when it
 * stops.
 */
export class BackgroundPreview {
  private session?: { stop: () => void };
  private warned = false;

  constructor(
    private readonly pages: PageSource,
    private readonly previewPort: number,
    private readonly hostOrigin: string,
    private readonly view: () => PreviewView,
    private readonly onReport: (report: BackgroundReport | null) => void,
  ) {}

  get active(): boolean {
    return this.session !== undefined;
  }

  start(): void {
    if (this.session) return;
    let stop = () => {};
    const stopped = new Promise<void>((resolve) => (stop = resolve));
    const session = { stop };
    this.session = session;
    const report = (value: BackgroundReport | null) => {
      if (this.session === session) this.onReport(value);
    };
    // Until the page reports, the fix loop waits for it as for a tab whose gallery is still loading.
    report({ errors: [], checks: [], checking: true, generation: -1 });
    const url = `${this.hostOrigin}${BACKGROUND_PATH}?port=${this.previewPort}`;
    void this.pages
      .withPage(async (page) => {
        await page.exposeFunction("basisView", () => this.view());
        await page.exposeFunction("basisReport", (raw: unknown) => report(parseReport(raw)));
        await page.goto(url);
        await stopped;
      })
      // The session stays until stop(), so a browser that cannot start is not tried again on every update.
      .catch((error: unknown) => {
        if (this.session !== session) return;
        report(null);
        if (this.warned) return;
        this.warned = true;
        console.warn(
          "[basis] no preview checks for a project in the background:",
          (error as Error).message.split("\n")[0],
        );
      });
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    session.stop();
    this.onReport(null);
  }
}
