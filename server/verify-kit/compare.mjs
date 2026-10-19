#!/usr/bin/env node
/*
 * Compares the implementation's screenshots with the design's, pixel for pixel. Part of the verification kit
 * Basis exports; it needs Node 22 and nothing else.
 *
 *   node basis-verify/compare.mjs [--expected <dir>] [--actual <dir>] [--diff <dir>] [--max-diff <percent>]
 *                                 [--tolerance <0-255>] [--box-tolerance <px>]
 *
 * Expected images come from expected/ (the design captured on this machine by `capture.mjs design`), or from
 * screens/ (captured by Basis) when expected/ has none. Actual images come from actual/ (`capture.mjs app`).
 * Every shot in basis-verify.json is compared; named exceptions in exceptions.json leave regions, elements (by
 * selector) or whole shots out. Elements marked data-basis-media (the design's placeholder images) are left out
 * of every shot. An element left out still has to be there, at the same place and size on both sides, within
 * --box-tolerance pixels (default 0). The command exits with 1 when any shot differs by more than --max-diff
 * (default 0).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes an 8-bit, non-interlaced PNG (what browsers' screenshots are) into RGBA pixels. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file.");
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette;
  let transparency;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const kind = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") transparency = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
  }
  const channels = CHANNELS[type];
  if (depth !== 8 || interlace !== 0 || !channels) {
    throw new Error("Only 8-bit, non-interlaced PNG files are supported.");
  }
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      const x = line[i];
      out[i] =
        filter === 0
          ? x
          : filter === 1
            ? x + a
            : filter === 2
              ? x + b
              : filter === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c);
    }
    previous = out;
  }
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels;
    const d = p * 4;
    if (type === 6) pixels.copy(data, d, s, s + 4);
    else if (type === 2) {
      data[d] = pixels[s];
      data[d + 1] = pixels[s + 1];
      data[d + 2] = pixels[s + 2];
      data[d + 3] = 255;
    } else if (type === 0 || type === 4) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s];
      data[d + 3] = type === 4 ? pixels[s + 1] : 255;
    } else {
      const index = pixels[s];
      data[d] = palette[index * 3];
      data[d + 1] = palette[index * 3 + 1];
      data[d + 2] = palette[index * 3 + 2];
      data[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { width, height, data };
}

function chunk(kind, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Compares two images on a canvas as large as both. A pixel differs when any channel differs by more than
 * `tolerance`; where only one image has pixels, they differ. Pixels inside `regions` are left out of the count.
 * The diff image shows the expected image faded, differing pixels red and left-out regions blue.
 */
export function compareImages(expected, actual, { tolerance = 0, regions = [] } = {}) {
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const diff = Buffer.alloc(width * height * 4);
  const inRegion = (x, y) => regions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  let differing = 0;
  let excluded = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      const inExpected = x < expected.width && y < expected.height;
      const inActual = x < actual.width && y < actual.height;
      const e = (y * expected.width + x) * 4;
      const a = (y * actual.width + x) * 4;
      if (inRegion(x, y)) {
        excluded++;
        diff[d] = 120;
        diff[d + 1] = 160;
        diff[d + 2] = 255;
        diff[d + 3] = 255;
        continue;
      }
      let same = inExpected && inActual;
      for (let c = 0; same && c < 4; c++) {
        if (Math.abs(expected.data[e + c] - actual.data[a + c]) > tolerance) same = false;
      }
      if (same) {
        const gray = Math.round(
          (expected.data[e] * 0.299 + expected.data[e + 1] * 0.587 + expected.data[e + 2] * 0.114) * 0.25 + 191,
        );
        diff[d] = diff[d + 1] = diff[d + 2] = gray;
      } else {
        differing++;
        diff[d] = 230;
        diff[d + 1] = 20;
        diff[d + 2] = 60;
      }
      diff[d + 3] = 255;
    }
  }
  const counted = width * height - excluded;
  return {
    width,
    height,
    sameSize: expected.width === actual.width && expected.height === actual.height,
    differing,
    counted,
    percent: counted ? (differing / counted) * 100 : 0,
    diff: { width, height, data: diff },
  };
}

/**
 * The marker of elements holding images that stand in for the product's own (photos, avatars, illustrations).
 * The kit leaves them out of every shot as long as their boxes match; the implementation marks its own the same.
 */
export const MEDIA_SELECTOR = "[data-basis-media]";

/** The file beside a shot that holds the boxes of the elements its exceptions name: `<shot>.boxes.json`. */
export function boxesFile(shotFile) {
  return shotFile.replace(/\.png$/, ".boxes.json");
}

/**
 * A script for page.evaluate that measures every element each selector matches, in the page's pixels (as a full
 * page screenshot has them), widened to whole pixels. Elements without a size are skipped; a selector that is not
 * valid gets null. A string rather than a function, so nothing a loader adds to a function's source reaches it.
 */
export function boxesExpression(selectors) {
  return `(() => {
  const boxes = {};
  for (const selector of ${JSON.stringify(selectors)}) {
    try {
      boxes[selector] = [...document.querySelectorAll(selector)].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        const x = Math.floor(rect.left + scrollX);
        const y = Math.floor(rect.top + scrollY);
        return [{ x, y, width: Math.ceil(rect.right + scrollX) - x, height: Math.ceil(rect.bottom + scrollY) - y }];
      });
    } catch {
      boxes[selector] = null;
    }
  }
  return boxes;
})()`;
}

/** The selector an exception names on one side: one for both, or `{ "design": ..., "app": ... }`. */
export function selectorFor(exception, side) {
  return typeof exception.selector === "string" ? exception.selector : exception.selector?.[side];
}

/** Every selector to measure on one side: the media marker and those the exceptions name. */
export function selectorsFor(exceptions, side, media = MEDIA_SELECTOR) {
  return [...new Set([media, ...exceptions.map((exception) => selectorFor(exception, side))].filter(Boolean))];
}

const describeBox = (box) => `${box.width}x${box.height} at ${box.x},${box.y}`;

/**
 * What one shot leaves out, and what is wrong with the elements it leaves out. Region exceptions leave out their
 * region. Selector exceptions, and the media marker, leave out the boxes of the elements they match on either
 * side, provided both sides have as many such elements at the same places and sizes (within `boxTolerance`
 * pixels); otherwise each mismatch is a problem, so a missing, moved or resized image still fails the shot.
 * `expectedBoxes` and `actualBoxes` are the shots' boxes files (undefined when there is none).
 */
export function shotExclusions(
  applying,
  { media = MEDIA_SELECTOR, expectedBoxes, actualBoxes, boxTolerance = 0 } = {},
) {
  const regions = [];
  const names = [];
  const problems = [];
  for (const exception of applying) {
    if (!exception.region) continue;
    regions.push(exception.region);
    names.push(exception.name);
  }
  const rules = [...(media ? [{ name: "media", selector: media }] : []), ...applying.filter((item) => item.selector)];
  for (const rule of rules) {
    const designSelector = selectorFor(rule, "design");
    const appSelector = selectorFor(rule, "app");
    const sides = [
      { label: "the design", selector: designSelector, boxes: expectedBoxes?.[designSelector], capture: "design" },
      { label: "the implementation", selector: appSelector, boxes: actualBoxes?.[appSelector], capture: "app" },
    ];
    const missing = sides.find((side) => !side.selector || side.boxes === undefined || side.boxes === null);
    if (missing) {
      problems.push(
        !missing.selector
          ? `exception "${rule.name}" names no selector for ${missing.label}`
          : missing.boxes === null
            ? `exception "${rule.name}": "${missing.selector}" is not a valid selector`
            : `exception "${rule.name}": ${missing.label} was captured without measuring "${missing.selector}"; run capture.mjs ${missing.capture} again`,
      );
      continue;
    }
    const [design, app] = sides.map((side) => side.boxes);
    // Left out on both sides even when they do not match, so the diff shows the boxes rather than their content.
    regions.push(...design, ...app);
    if (design.length || app.length) names.push(rule.name);
    if (design.length !== app.length) {
      const count = (n) => `${n} ${n === 1 ? "element matches" : "elements match"}`;
      problems.push(
        `exception "${rule.name}": ${count(design.length)} "${designSelector}" in the design, ${count(app.length)} "${appSelector}" in the implementation`,
      );
      continue;
    }
    const off = (a, b) => ["x", "y", "width", "height"].some((key) => Math.abs(a[key] - b[key]) > boxTolerance);
    design.forEach((box, index) => {
      if (off(box, app[index])) {
        problems.push(
          `exception "${rule.name}": element ${index + 1} of "${appSelector}" is ${describeBox(app[index])}, in the design ${describeBox(box)}`,
        );
      }
    });
  }
  return { regions, names, problems };
}

/** The exceptions that apply to one shot: those naming its view, and its screen, widths and themes if they say. */
export function exceptionsFor(exceptions, shot) {
  return exceptions.filter(
    (exception) =>
      exception.view === shot.view &&
      (exception.screen === undefined || exception.screen === shot.screen) &&
      (exception.widths === undefined || exception.widths.includes(shot.width)) &&
      (exception.themes === undefined || exception.themes.includes(shot.theme)),
  );
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function main() {
  const kit = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const resolve = (name, fallback) => {
    const value = option(args, name);
    return value ? path.resolve(value) : path.join(kit, fallback);
  };
  const expectedDir = resolve("--expected", "expected");
  const shippedDir = path.join(kit, "screens");
  const actualDir = resolve("--actual", "actual");
  const diffDir = resolve("--diff", "diff");
  const maxDiff = Number(option(args, "--max-diff", "0"));
  const tolerance = Number(option(args, "--tolerance", "0"));
  const boxTolerance = Number(option(args, "--box-tolerance", "0"));
  const manifest = JSON.parse(await readFile(path.join(kit, "basis-verify.json"), "utf8"));
  const exceptionsFile = path.join(kit, "exceptions.json");
  const exceptions = existsSync(exceptionsFile)
    ? (JSON.parse(await readFile(exceptionsFile, "utf8")).exceptions ?? [])
    : [];
  // A kit from before the marker has no media entry, and leaves nothing out by it.
  const media = manifest.media?.selector ?? null;
  const readBoxes = async (png) => {
    const file = boxesFile(png);
    return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : undefined;
  };

  const results = [];
  for (const view of manifest.views) {
    for (const screen of view.screens) {
      for (const shot of screen.shots) {
        const file = shot.file;
        const name = file.replace(/^screens\//, "");
        const own = path.join(expectedDir, name);
        const expectedPath = existsSync(own) ? own : path.join(shippedDir, name);
        const actualPath = path.join(actualDir, name);
        const result = { file: name, view: view.id, screen: screen.id, width: shot.width, theme: shot.theme };
        const applying = exceptionsFor(exceptions, result);
        const whole = applying.find((exception) => !exception.region && !exception.selector);
        if (whole) {
          results.push({ ...result, status: "excepted", exception: whole.name });
          continue;
        }
        if (!existsSync(actualPath)) {
          results.push({ ...result, status: "missing", message: `No ${path.relative(process.cwd(), actualPath)}` });
          continue;
        }
        const expected = decodePng(await readFile(expectedPath));
        const actual = decodePng(await readFile(actualPath));
        const left = shotExclusions(applying, {
          media,
          expectedBoxes: await readBoxes(expectedPath),
          actualBoxes: await readBoxes(actualPath),
          boxTolerance,
        });
        const outcome = compareImages(expected, actual, { tolerance, regions: left.regions });
        const passed = outcome.sameSize && outcome.percent <= maxDiff && left.problems.length === 0;
        if (!passed) {
          const target = path.join(diffDir, name);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, encodePng(outcome.diff));
        }
        results.push({
          ...result,
          status: passed ? "pass" : "fail",
          percent: Number(outcome.percent.toFixed(4)),
          differingPixels: outcome.differing,
          expectedSize: `${expected.width}x${expected.height}`,
          actualSize: `${actual.width}x${actual.height}`,
          exceptions: left.names,
          problems: left.problems,
          reference: path.relative(kit, expectedPath).split(path.sep).join("/"),
        });
      }
    }
  }

  for (const result of results) {
    const label = result.status.toUpperCase().padEnd(8);
    let detail = "";
    if (result.status === "excepted") detail = `exception "${result.exception}"`;
    else if (result.status === "missing") detail = result.message;
    else {
      detail = `${result.percent.toFixed(4)}% (${result.differingPixels} px)`;
      if (result.expectedSize !== result.actualSize) {
        detail += `, size ${result.actualSize}, expected ${result.expectedSize}`;
      }
      if (result.exceptions.length) detail += `, left out: ${result.exceptions.join(", ")}`;
    }
    console.log(`${label} ${result.file.padEnd(48)} ${detail}`);
    for (const problem of result.problems ?? []) console.log(`         ${problem}`);
  }
  const failed = results.filter((result) => result.status === "fail" || result.status === "missing");
  await mkdir(diffDir, { recursive: true });
  await writeFile(
    path.join(diffDir, "report.json"),
    `${JSON.stringify({ maxDiff, tolerance, boxTolerance, results }, null, 2)}\n`,
  );
  console.log(
    failed.length
      ? `\n${failed.length} of ${results.length} shots do not match. Diff images are in ${path.relative(process.cwd(), diffDir) || "."}.`
      : `\nAll ${results.length} shots match.`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
