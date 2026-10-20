import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright-core";
import { shotFile, type CaptureView } from "../shared/capture.ts";
import { CAPTURE_CONTEXT, launchCaptureBrowser, takeShot, type CaptureBrowser } from "./capture.ts";
import { NEUTRAL_CSS } from "./verify.ts";
import {
  boxesExpression,
  compareImages,
  decodePng,
  encodePng,
  exceptionsFor,
  MEDIA_SELECTOR,
  selectorsFor,
  shotExclusions,
  type Boxes,
  type Exception,
} from "./verify-kit/compare.mjs";

/*
 * basis-diff: proof that an implementation looks like its view, which the agent that built it cannot make up.
 * The agent (or a pipeline) gives only the URLs of the product's pages. Basis photographs the view's screens from
 * its own preview and the product's pages with the same browser and settings, compares them with the kit's own
 * rules (compare.mjs), and keeps the images and the verdict in BASIS_HOME/verifications/, outside every
 * workspace: nothing the agent writes, in the product or in Basis, reaches them, and the API has no call that
 * changes or deletes one.
 *
 * The verdict, `pass`, leaves out only the elements marked as media (data-basis-media), whose boxes must match.
 * Exceptions the request declares are claims, not proof: they are applied in a second verdict,
 * `passWithExceptions`, and listed, so a person decides whether they are fair.
 */

/** Where a screen of the product is: a URL, absolute or relative to `baseUrl`, and an element to wait for. */
export type DiffTarget = string | { url: string; waitFor?: string };

export interface DiffRequest {
  /** The product's pages per screen, keyed by screen id or "view/screen" as in the kit's targets.json. */
  targets: { baseUrl?: string; screens: Record<string, DiffTarget>; themeAttribute?: string };
  /** Exceptions as in the kit's exceptions.json; applied only to `passWithExceptions`. */
  exceptions?: DiffException[];
  /** What was checked, in the requester's words: an issue, a branch, a commit. */
  label?: string;
}

export interface DiffException {
  name: string;
  reason?: string;
  view?: string;
  screen?: string;
  widths?: number[];
  themes?: string[];
  region?: { x: number; y: number; width: number; height: number };
  selector?: string | { design?: string; app?: string };
}

type Status = "pass" | "fail" | "missing" | "excepted";

export interface DiffShot {
  file: string;
  screen: string;
  width: number;
  theme: string;
  url?: string;
  /** The verdict leaving out only media; `missing` when the request names no page for the screen. */
  status: Status;
  percent?: number;
  differingPixels?: number;
  expectedSize?: string;
  actualSize?: string;
  problems: string[];
  /** The verdict with the request's exceptions applied, and the names of those that applied. */
  withExceptions: { status: Status; percent?: number; exceptions: string[]; problems: string[] };
}

export interface DiffReport {
  id: string;
  project: string;
  view: string;
  title: string;
  label: string | null;
  createdAt: string;
  /** The workspace commit the design was photographed at. */
  designCommit: string | null;
  browser: string;
  targets: DiffRequest["targets"];
  exceptions: DiffException[];
  pass: boolean;
  passWithExceptions: boolean;
  shots: DiffShot[];
  /** SHA-256 of every image kept with the report, by its path in the report's folder. */
  files: Record<string, string>;
}

/** A report as the list shows it. */
export type DiffSummary = Pick<
  DiffReport,
  "id" | "view" | "title" | "label" | "createdAt" | "pass" | "passWithExceptions"
> & {
  shots: number;
  failed: number;
};

const ID = /^[a-z0-9-]{1,120}$/;

/** The URL of one screen's page, or an error for a target that is not an http(s) URL. */
export function targetUrl(
  targets: DiffRequest["targets"],
  view: string,
  screen: string,
): { url: string; waitFor?: string } | null {
  const entry = targets.screens[screen] ?? targets.screens[`${view}/${screen}`];
  if (entry === undefined) return null;
  const target = typeof entry === "string" ? { url: entry } : entry;
  const url = new URL(target.url, targets.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${screen}: only http and https pages can be checked`);
  return { url: url.href, ...(target.waitFor ? { waitFor: target.waitFor } : {}) };
}

/** Checks a request's shape; the message says what is wrong. */
export function checkDiffRequest(body: unknown): DiffRequest {
  const request = (body ?? {}) as Partial<DiffRequest>;
  const targets = request.targets;
  if (!targets || typeof targets !== "object" || !targets.screens || typeof targets.screens !== "object")
    throw new Error("Give targets: { baseUrl?, screens: { <screen>: url | { url, waitFor? } } }.");
  if (targets.baseUrl !== undefined && typeof targets.baseUrl !== "string")
    throw new Error("targets.baseUrl is a URL.");
  if (request.exceptions !== undefined && !Array.isArray(request.exceptions)) throw new Error("exceptions is a list.");
  return {
    targets,
    exceptions: (request.exceptions ?? []).filter((item): item is DiffException =>
      Boolean(item && typeof item.name === "string"),
    ),
    ...(typeof request.label === "string" ? { label: request.label.slice(0, 200) } : {}),
  };
}

/**
 * Settles a product's page as the kit's capture.mjs does: fonts, images, and a page that stopped growing. A string,
 * since tsx may add helpers to a function's source that the page does not have.
 */
const SETTLE = `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  let last = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(50);
    const size = document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight;
    if (size === last) break;
    last = size;
  }
})()`;

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export interface RunDiffOptions {
  /** The capture page of the project's live preview (Screenshots.pageUrl). */
  captureUrl: string;
  view: CaptureView;
  project: string;
  designCommit: string | null;
  request: DiffRequest;
  /** The folder the report and its images go into; it must not exist yet. */
  dir: string;
  id: string;
  launch?: () => Promise<CaptureBrowser>;
}

/** Photographs both sides of every shot of the view, compares them and writes the report with its images. */
export async function runDiff(options: RunDiffOptions): Promise<DiffReport> {
  const { view, request, dir } = options;
  // An exception that names no view is about this one.
  const exceptions: Exception[] = (request.exceptions ?? []).map((item) => ({ ...item, view: item.view ?? view.id }));
  const { browser, name, version } = await (options.launch ?? launchCaptureBrowser)();
  const files: Record<string, string> = {};
  const keep = async (relative: string, data: Uint8Array) => {
    const target = path.join(dir, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    files[relative] = sha256(data);
  };
  const shots: DiffShot[] = [];
  try {
    const designSelectors = selectorsFor(exceptions, "design");
    const appSelectors = selectorsFor(exceptions, "app");
    const design = await (browser as Browser).newContext(CAPTURE_CONTEXT);
    const app = await (browser as Browser).newContext(CAPTURE_CONTEXT);
    try {
      const designPage = await design.newPage();
      const appPage = await app.newPage();
      for (const screen of view.screens) {
        const target = targetUrl(request.targets, view.id, screen.id);
        for (const shot of screen.shots) {
          const file = shotFile(view.id, screen.id, shot).replace(/^screens\//, "");
          const base = { file, screen: screen.id, width: shot.width, theme: shot.theme };
          if (!target) {
            const missing = { status: "missing" as const, problems: [`No page for ${screen.id} in targets.`] };
            shots.push({ ...base, ...missing, withExceptions: { ...missing, exceptions: [] } });
            continue;
          }
          const query = `?view=${encodeURIComponent(view.id)}&screen=${encodeURIComponent(screen.id)}&theme=${shot.theme}`;
          const expected = await takeShot(designPage, `${options.captureUrl}${query}`, shot);
          const expectedBoxes = (await designPage.evaluate(boxesExpression(designSelectors))) as Boxes;

          await appPage.setViewportSize({ width: shot.width, height: shot.viewportHeight });
          await appPage.emulateMedia({ colorScheme: shot.theme as "light" | "dark" });
          await appPage.goto(target.url, { waitUntil: "networkidle", timeout: 60_000 });
          if (target.waitFor) await appPage.waitForSelector(target.waitFor, { timeout: 60_000 });
          if (request.targets.themeAttribute) {
            await appPage.evaluate(
              `document.documentElement.setAttribute(${JSON.stringify(request.targets.themeAttribute)}, ${JSON.stringify(shot.theme)})`,
            );
          }
          await appPage.addStyleTag({ content: NEUTRAL_CSS });
          await appPage.evaluate(SETTLE);
          const actualPng = await appPage.screenshot({
            fullPage: shot.fullPage,
            animations: "disabled",
            caret: "hide",
          });
          const actualBoxes = (await appPage.evaluate(boxesExpression(appSelectors))) as Boxes;

          await keep(`expected/${file}`, expected.png);
          await keep(`actual/${file}`, actualPng);
          const expectedImage = decodePng(expected.png);
          const actualImage = decodePng(actualPng);
          const judge = (applying: Exception[]) => {
            const whole = applying.find((exception) => !exception.region && !exception.selector);
            if (whole) return { status: "excepted" as const, exceptions: [whole.name], problems: [], diff: null };
            const left = shotExclusions(applying, { media: MEDIA_SELECTOR, expectedBoxes, actualBoxes });
            const outcome = compareImages(expectedImage, actualImage, { regions: left.regions });
            const passed = outcome.sameSize && outcome.percent === 0 && left.problems.length === 0;
            return {
              status: passed ? ("pass" as const) : ("fail" as const),
              percent: Number(outcome.percent.toFixed(4)),
              differing: outcome.differing,
              exceptions: left.names,
              problems: [
                ...(outcome.sameSize
                  ? []
                  : [
                      `size ${actualImage.width}x${actualImage.height}, the design is ${expectedImage.width}x${expectedImage.height}`,
                    ]),
                ...left.problems,
              ],
              diff: passed ? null : outcome.diff,
            };
          };
          const strict = judge([]);
          const declared = judge(exceptionsFor(exceptions, { view: view.id, ...base }));
          if (strict.diff) await keep(`diff/${file}`, encodePng(strict.diff));
          shots.push({
            ...base,
            url: target.url,
            status: strict.status,
            percent: strict.percent,
            differingPixels: strict.differing,
            expectedSize: `${expectedImage.width}x${expectedImage.height}`,
            actualSize: `${actualImage.width}x${actualImage.height}`,
            problems: [...(expected.failed ? ["the design's screen threw while rendering"] : []), ...strict.problems],
            withExceptions: {
              status: declared.status,
              percent: declared.percent,
              exceptions: declared.exceptions,
              problems: declared.problems,
            },
          });
        }
      }
    } finally {
      await design.close();
      await app.close();
    }
  } finally {
    await browser.close();
  }
  const report: DiffReport = {
    id: options.id,
    project: options.project,
    view: view.id,
    title: view.title,
    label: request.label ?? null,
    createdAt: new Date().toISOString(),
    designCommit: options.designCommit,
    browser: `${name} ${version}`,
    targets: request.targets,
    exceptions,
    pass: shots.length > 0 && shots.every((shot) => shot.status === "pass"),
    passWithExceptions:
      shots.length > 0 && shots.every((shot) => ["pass", "excepted"].includes(shot.withExceptions.status)),
    shots,
    files,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** The reports kept for each project: `<root>/<project>/<id>/report.json` with the images beside it. */
export class Verifications {
  constructor(private readonly root: string) {}

  /** A new report's id and folder: the view, the time and a random suffix, never one that exists. */
  async create(project: string, view: string): Promise<{ id: string; dir: string }> {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase();
    const id = `${view}-${stamp}-${randomBytes(3).toString("hex")}`.slice(0, 120);
    const dir = path.join(this.root, project, id);
    await mkdir(dir, { recursive: true });
    return { id, dir };
  }

  async get(project: string, id: string): Promise<DiffReport | null> {
    if (!ID.test(project) || !ID.test(id)) return null;
    const raw = await readFile(path.join(this.root, project, id, "report.json"), "utf8").catch(() => null);
    return raw ? (JSON.parse(raw) as DiffReport) : null;
  }

  /** The project's reports, newest first, of one view when given. */
  async list(project: string, view?: string): Promise<DiffSummary[]> {
    if (!ID.test(project)) return [];
    const ids = await readdir(path.join(this.root, project)).catch(() => [] as string[]);
    const reports = await Promise.all(ids.map((id) => this.get(project, id)));
    return reports
      .filter((report): report is DiffReport => report !== null && (!view || report.view === view))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((report) => ({
        id: report.id,
        view: report.view,
        title: report.title,
        label: report.label,
        createdAt: report.createdAt,
        pass: report.pass,
        passWithExceptions: report.passWithExceptions,
        shots: report.shots.length,
        failed: report.shots.filter((shot) => shot.status !== "pass").length,
      }));
  }

  /** One image kept with a report, checked against the hash the report recorded; null when it is not one. */
  async file(project: string, id: string, relative: string): Promise<Buffer | null> {
    const report = await this.get(project, id);
    const hash = report?.files[relative];
    if (!report || !hash) return null;
    const data = await readFile(path.join(this.root, project, id, ...relative.split("/"))).catch(() => null);
    return data && sha256(data) === hash ? data : null;
  }
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The report as a page for people: the verdicts, each shot with the design, the product and the difference. */
export function reportPage(report: DiffReport, filesBase: string): string {
  const verdict = (pass: boolean) => (pass ? `<b class="pass">Matches</b>` : `<b class="fail">Does not match</b>`);
  const image = (kind: string, file: string) =>
    report.files[`${kind}/${file}`]
      ? `<figure><img src="${escape(`${filesBase}/${kind}/${file}`)}" alt="${kind} ${escape(file)}"><figcaption>${kind === "expected" ? "Design" : kind === "actual" ? "Product" : "Difference"}</figcaption></figure>`
      : "";
  const rows = report.shots
    .map(
      (shot) => `<section>
<h2>${escape(shot.file)} <span class="${shot.status}">${shot.status}${shot.percent !== undefined ? ` · ${shot.percent}%` : ""}</span></h2>
${shot.url ? `<p class="muted">${escape(shot.url)}</p>` : ""}
${shot.problems.map((problem) => `<p class="fail">${escape(problem)}</p>`).join("")}
${shot.withExceptions.exceptions.length ? `<p class="muted">With the declared exceptions (${escape(shot.withExceptions.exceptions.join(", "))}): ${shot.withExceptions.status}</p>` : ""}
<div class="images">${image("expected", shot.file)}${image("actual", shot.file)}${image("diff", shot.file)}</div>
</section>`,
    )
    .join("\n");
  const declared = report.exceptions.length
    ? `<h2>Declared exceptions</h2><ul>${report.exceptions.map((item) => `<li><b>${escape(item.name)}</b>: ${escape(item.reason ?? "no reason given")}</li>`).join("")}</ul>`
    : "";
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(report.title)}: verification</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --text: #1b1b19; --muted: #6b6b66; --line: #d9d9d4; --pass: #1f7a3a; --fail: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141413; --text: #ececea; --muted: #9b9b95; --line: #2f2f2c; --pass: #6fcf8b; --fail: #ff8a80; } }
  body { margin: 0 auto; max-width: 1400px; padding: 24px 16px; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20px; } h2 { font-size: 15px; margin: 0 0 6px; }
  section { border-top: 1px solid var(--line); padding: 16px 0; }
  .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; align-items: start; }
  figure { margin: 0; } img { max-width: 100%; border: 1px solid var(--line); } figcaption, .muted { color: var(--muted); }
  .pass { color: var(--pass); } .fail, .missing { color: var(--fail); } .excepted { color: var(--muted); }
  p { margin: 2px 0; overflow-wrap: anywhere; }
</style>
<h1>${escape(report.title)}</h1>
<p>${verdict(report.pass)} · with the declared exceptions: ${verdict(report.passWithExceptions)}</p>
<p class="muted">${escape(report.label ?? "")} · ${escape(report.createdAt)} · design ${escape(report.designCommit?.slice(0, 10) ?? "unknown")} · ${escape(report.browser)} · ${escape(report.id)}</p>
<p class="muted">Basis took every image here itself, from its own design and from the product's pages, and keeps them out of reach of the agent that built the product.</p>
${declared}
${rows}
</html>`;
}
