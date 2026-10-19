#!/usr/bin/env node
/*
 * Takes the verification kit's screenshots on this machine, with the settings Basis used (basis-verify.json):
 *
 *   node basis-verify/capture.mjs design [--out <dir>]                     the design, into expected/
 *   node basis-verify/capture.mjs app [--targets <file>] [--out <dir>]     the implementation, into actual/
 *
 * Options for both: --only <view>[/<screen>] to capture part of the kit, --channel chrome|msedge to use an
 * installed browser instead of Playwright's Chromium.
 *
 * Needs Playwright in the project (`npm i -D playwright` and `npx playwright install chromium`). Capture both
 * sides with the same machine and browser: fonts and antialiasing differ between systems, so only images taken
 * the same way can match pixel for pixel. Compare them with compare.mjs.
 *
 * Beside each image it writes `<shot>.boxes.json`: the boxes of the elements marked data-basis-media and of those
 * the selectors in exceptions.json match, which compare.mjs leaves out and checks for place and size.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boxesExpression, boxesFile, selectorsFor } from "./compare.mjs";

const kit = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args[0];

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function playwright() {
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      const module = await import(name);
      return module.chromium ?? module.default?.chromium;
    } catch {
      // Not installed here; try the next one.
    }
  }
  throw new Error(
    "Playwright is not installed in this project. Run `npm i -D playwright` and `npx playwright install chromium`.",
  );
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Serves the kit's copy of the design on a free local port. */
async function serveDesign() {
  const root = path.join(kit, "design");
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
    const file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/index.html` };
}

/** Waits until fonts are loaded, images decoded and the layout keeps its size, as the design's page does. */
async function settle(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
    let last = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      await wait(50);
      const size = `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`;
      if (size === last) break;
      last = size;
    }
  });
}

function targetFor(targets, view, screen) {
  const entry = targets.screens?.[`${view}/${screen}`];
  if (!entry) return undefined;
  const target = typeof entry === "string" ? { url: entry } : entry;
  return { ...target, url: new URL(target.url, targets.baseUrl ?? undefined).href };
}

async function main() {
  if (mode !== "design" && mode !== "app") {
    console.error("Usage: node capture.mjs design|app [--targets <file>] [--out <dir>] [--only <view>[/<screen>]]");
    process.exitCode = 2;
    return;
  }
  const manifest = JSON.parse(await readFile(path.join(kit, "basis-verify.json"), "utf8"));
  const { render } = manifest;
  const out = option("--out")
    ? path.resolve(option("--out"))
    : path.join(kit, mode === "design" ? "expected" : "actual");
  const only = option("--only");
  let targets = {};
  const targetsFile = option("--targets") ? path.resolve(option("--targets")) : path.join(kit, "targets.json");
  if (mode === "app") {
    if (!existsSync(targetsFile)) {
      throw new Error(`No targets file at ${targetsFile}. See README.md, "Capture the implementation".`);
    }
    targets = JSON.parse(await readFile(targetsFile, "utf8"));
  }
  const exceptionsFile = path.join(kit, "exceptions.json");
  const exceptions = existsSync(exceptionsFile)
    ? (JSON.parse(await readFile(exceptionsFile, "utf8")).exceptions ?? [])
    : [];
  const selectors = selectorsFor(exceptions, mode, manifest.media?.selector ?? null);
  const invalid = new Set();

  const chromium = await playwright();
  const browser = await chromium.launch({ headless: true, args: render.args, channel: option("--channel") });
  console.log(
    `Browser: ${browser.version()}${browser.version() === manifest.browser.version ? "" : ` (Basis used ${manifest.browser.version})`}`,
  );
  const design = mode === "design" ? await serveDesign() : undefined;
  const context = await browser.newContext({
    deviceScaleFactor: render.deviceScaleFactor,
    reducedMotion: render.reducedMotion,
    colorScheme: render.colorScheme,
    viewport: { width: 1440, height: 900 },
    ...(mode === "app" && targets.storageState
      ? { storageState: path.resolve(path.dirname(targetsFile), targets.storageState) }
      : {}),
  });
  const page = await context.newPage();
  let taken = 0;
  let skipped = 0;
  const unstable = [];
  try {
    for (const view of manifest.views) {
      for (const screen of view.screens) {
        const key = `${view.id}/${screen.id}`;
        if (only && only !== view.id && only !== key) continue;
        const target = mode === "app" ? targetFor(targets, view.id, screen.id) : undefined;
        if (mode === "app" && !target) {
          console.log(`skip     ${key}: no target in targets.json`);
          skipped++;
          continue;
        }
        for (const shot of screen.shots) {
          await page.setViewportSize({ width: shot.width, height: shot.viewportHeight });
          await page.emulateMedia({ colorScheme: shot.theme });
          const take = async () => {
            if (design) {
              const query = `?view=${encodeURIComponent(view.id)}&screen=${encodeURIComponent(screen.id)}&theme=${shot.theme}`;
              await page.goto(design.url + query);
              await page.waitForSelector(manifest.design.ready, { state: "attached", timeout: 60_000 });
            } else {
              await page.goto(target.url, { waitUntil: "networkidle" });
              if (target.waitFor) await page.waitForSelector(target.waitFor, { timeout: 60_000 });
              if (targets.themeAttribute) {
                await page.evaluate(
                  ([name, value]) => document.documentElement.setAttribute(name, value),
                  [targets.themeAttribute, shot.theme],
                );
              }
              await page.addStyleTag({ content: render.neutralCss });
              await settle(page);
            }
            const png = await page.screenshot({ fullPage: shot.fullPage, animations: "disabled", caret: "hide" });
            return { png, boxes: selectors.length ? await page.evaluate(boxesExpression(selectors)) : {} };
          };
          const first = await take();
          const second = await take();
          const name = shot.file.replace(/^screens\//, "");
          const file = path.join(out, name);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, first.png);
          await writeFile(boxesFile(file), `${JSON.stringify(first.boxes, null, 2)}\n`);
          for (const [selector, boxes] of Object.entries(first.boxes)) if (boxes === null) invalid.add(selector);
          taken++;
          const stable = first.png.equals(second.png);
          if (!stable) unstable.push(name);
          console.log(`${stable ? "ok      " : "UNSTABLE"} ${name}`);
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
    design?.server.close();
  }
  console.log(
    `\n${taken} shots in ${path.relative(process.cwd(), out) || "."}${skipped ? `, ${skipped} screens without a target` : ""}.`,
  );
  if (unstable.length) {
    console.log(
      `${unstable.length} shots differed between two captures, so they can never match exactly: ${unstable.join(", ")}. ` +
        "Look for clocks, random values, animations or content that loads late.",
    );
  }
  if (invalid.size) console.log(`Not valid selectors in exceptions.json: ${[...invalid].join(", ")}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
