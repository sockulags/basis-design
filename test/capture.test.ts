import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { captureShots, listQuery, listWidths, shotFile, viewportHeightFor } from "../shared/capture.ts";
import { isRemoteMedia } from "../server/capture.ts";
import {
  boxesExpression,
  boxesFile,
  compareImages,
  decodePng,
  encodePng,
  exceptionsFor,
  selectorFor,
  selectorsFor,
  shotExclusions,
} from "../server/verify-kit/compare.mjs";

function image(width: number, height: number, color: [number, number, number]) {
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([...color, 255], p * 4);
  return { width, height, data };
}

test("a flow without capture options is shot at three widths, full page, light", () => {
  assert.deepEqual(captureShots(undefined), [
    { width: 375, viewportHeight: 812, fullPage: true, theme: "light" },
    { width: 768, viewportHeight: 1024, fullPage: true, theme: "light" },
    { width: 1440, viewportHeight: 900, fullPage: true, theme: "light" },
  ]);
});

test("a flow without capture widths takes the project's, and its own widths win", () => {
  const project = [390, 820, 1280];
  assert.deepEqual(
    captureShots({ themes: ["dark"] }, project).map((shot) => `${shot.width}-${shot.theme}`),
    ["390-dark", "820-dark", "1280-dark"],
  );
  assert.deepEqual(
    captureShots({ widths: [1024] }, project).map((shot) => shot.width),
    [1024],
  );
});

test("the capture page's list query carries the project's widths, and nonsense falls back to Basis' own", () => {
  assert.equal(listQuery([390, 768, 1440]), "?list&widths=390,768,1440");
  assert.deepEqual(listWidths("390,768,1440"), [390, 768, 1440]);
  assert.deepEqual(listWidths("390,abc,90000"), [390]);
  assert.deepEqual(listWidths(null), [375, 768, 1440]);
  assert.deepEqual(listWidths(""), [375, 768, 1440]);
});

test("capture options are deduplicated, sorted and kept within sensible sizes", () => {
  const shots = captureShots({ widths: [1280, 320, 320, 10, 9000], height: 700, themes: ["light", "dark"] });
  assert.deepEqual(
    shots.map((shot) => [shot.width, shot.viewportHeight, shot.fullPage, shot.theme]),
    [
      [320, 700, false, "light"],
      [1280, 700, false, "light"],
      [320, 700, false, "dark"],
      [1280, 700, false, "dark"],
    ],
  );
  // A height out of range falls back to the full page.
  assert.equal(captureShots({ height: 50 })[0]?.fullPage, true);
});

test("viewport heights follow the width", () => {
  assert.deepEqual([375, 480, 768, 1024, 1440].map(viewportHeightFor), [812, 812, 1024, 1024, 900]);
});

test("shot files name the view, screen, width, fixed height and a dark theme", () => {
  assert.equal(shotFile("orders", "list", captureShots(undefined)[0]!), "screens/orders/list@375.png");
  const [dark] = captureShots({ widths: [800], height: 600, themes: ["dark"] });
  assert.equal(shotFile("orders", "detail", dark!), "screens/orders/detail@800x600-dark.png");
});

test("PNG images survive encoding and decoding", () => {
  const original = image(7, 5, [12, 200, 99]);
  original.data.set([1, 2, 3, 4], 0);
  const decoded = decodePng(encodePng(original));
  assert.equal(decoded.width, 7);
  assert.equal(decoded.height, 5);
  assert.deepEqual(decoded.data, original.data);
});

test("identical images do not differ; a changed pixel does", () => {
  const expected = image(10, 10, [255, 255, 255]);
  const actual = image(10, 10, [255, 255, 255]);
  assert.equal(compareImages(expected, actual).differing, 0);
  actual.data.set([0, 0, 0, 255], (3 * 10 + 4) * 4);
  const result = compareImages(expected, actual);
  assert.equal(result.differing, 1);
  assert.equal(result.percent, 1);
  // A small tolerance does not hide a black pixel on white.
  assert.equal(compareImages(expected, actual, { tolerance: 10 }).differing, 1);
});

test("an image of another size differs where only one has pixels", () => {
  const result = compareImages(image(10, 10, [0, 0, 0]), image(10, 12, [0, 0, 0]));
  assert.equal(result.sameSize, false);
  assert.equal(result.differing, 20);
});

test("regions of exceptions are left out of the count", () => {
  const expected = image(10, 10, [255, 255, 255]);
  const actual = image(10, 10, [255, 255, 255]);
  actual.data.set([0, 0, 0, 255], 0);
  const result = compareImages(expected, actual, { regions: [{ x: 0, y: 0, width: 2, height: 2 }] });
  assert.equal(result.differing, 0);
  assert.equal(result.counted, 96);
});

test("exceptions apply to the view, screens, widths and themes they name", () => {
  const exceptions = [
    { name: "all", view: "orders" },
    { name: "list-narrow", view: "orders", screen: "list", widths: [375] },
    { name: "dark", view: "orders", themes: ["dark"] },
    { name: "other", view: "people" },
  ];
  const names = (shot: { view: string; screen: string; width: number; theme: string }) =>
    exceptionsFor(exceptions, shot).map((exception) => exception.name);
  assert.deepEqual(names({ view: "orders", screen: "list", width: 375, theme: "light" }), ["all", "list-narrow"]);
  assert.deepEqual(names({ view: "orders", screen: "list", width: 768, theme: "dark" }), ["all", "dark"]);
  assert.deepEqual(names({ view: "people", screen: "list", width: 375, theme: "light" }), ["other"]);
});

test("selector exceptions leave out matching boxes and fail when the boxes differ", () => {
  const box = { x: 16, y: 40, width: 120, height: 80 };
  const exception = { name: "chart", view: "orders", selector: "canvas" };
  const clean = shotExclusions([exception], {
    expectedBoxes: { "[data-basis-media]": [], canvas: [box] },
    actualBoxes: { "[data-basis-media]": [], canvas: [box] },
  });
  assert.deepEqual(clean, { regions: [box, box], names: ["chart"], problems: [] });
  // A box that moved or changed size fails, beyond the tolerance.
  const moved = { ...box, height: 81 };
  const options = (actual: typeof box) => ({
    expectedBoxes: { "[data-basis-media]": [], canvas: [box] },
    actualBoxes: { "[data-basis-media]": [], canvas: [actual] },
  });
  assert.deepEqual(shotExclusions([exception], options(moved)).problems, [
    'exception "chart": element 1 of "canvas" is 120x81 at 16,40, in the design 120x80 at 16,40',
  ]);
  assert.deepEqual(shotExclusions([exception], { ...options(moved), boxTolerance: 1 }).problems, []);
  // A missing element fails, and its box is still left out of the pixels.
  const missing = shotExclusions([exception], {
    expectedBoxes: { "[data-basis-media]": [], canvas: [box] },
    actualBoxes: { "[data-basis-media]": [], canvas: [] },
  });
  assert.deepEqual(missing.regions, [box]);
  assert.match(
    missing.problems[0]!,
    /1 element matches "canvas" in the design, 0 elements match "canvas" in the implementation/,
  );
});

test("the media marker applies to every shot, and capture problems are named", () => {
  const photo = { x: 0, y: 0, width: 300, height: 200 };
  const marked = { "[data-basis-media]": [photo] };
  assert.deepEqual(shotExclusions([], { expectedBoxes: marked, actualBoxes: marked }).names, ["media"]);
  // An implementation that does not mark its image fails.
  assert.match(
    shotExclusions([], { expectedBoxes: marked, actualBoxes: { "[data-basis-media]": [] } }).problems[0]!,
    /^exception "media": 1 element matches/,
  );
  // A kit without the marker leaves nothing out by it.
  assert.deepEqual(shotExclusions([], { media: null, expectedBoxes: marked }), {
    regions: [],
    names: [],
    problems: [],
  });
  const exception = { name: "map", view: "orders", selector: { design: "[data-map]", app: "#map" } };
  assert.deepEqual(
    shotExclusions([exception], { media: null, expectedBoxes: { "[data-map]": [photo] }, actualBoxes: undefined })
      .problems,
    ['exception "map": the implementation was captured without measuring "#map"; run capture.mjs app again'],
  );
  assert.deepEqual(
    shotExclusions([exception], { media: null, expectedBoxes: { "[data-map]": null }, actualBoxes: {} }).problems,
    ['exception "map": "[data-map]" is not a valid selector'],
  );
  // Region exceptions keep working beside selectors.
  const region = { x: 1, y: 2, width: 3, height: 4 };
  assert.deepEqual(shotExclusions([{ name: "corner", view: "orders", region }], { media: null }).regions, [region]);
});

test("each side measures the media marker and its own selectors", () => {
  const exceptions = [
    { selector: "canvas" },
    { selector: { design: "[data-map]", app: "#map" } },
    { region: { x: 0, y: 0, width: 1, height: 1 } },
  ];
  assert.deepEqual(selectorsFor(exceptions, "design"), ["[data-basis-media]", "canvas", "[data-map]"]);
  assert.deepEqual(selectorsFor(exceptions, "app", null), ["canvas", "#map"]);
  assert.equal(selectorFor({ selector: "img" }, "app"), "img");
  assert.equal(boxesFile("screens/orders/list@375.png"), "screens/orders/list@375.boxes.json");
});

test("boxes are measured in the page's pixels, widened to whole pixels, without empty or invalid ones", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  const elements: Record<string, { getBoundingClientRect: () => ReturnType<typeof rect> }[]> = {
    img: [
      { getBoundingClientRect: () => rect(10.5, 20.25, 100, 50) },
      { getBoundingClientRect: () => rect(0, 0, 0, 0) },
    ],
  };
  const document = {
    querySelectorAll: (selector: string) => {
      if (selector === "[") throw new Error("not valid");
      return elements[selector] ?? [];
    },
  };
  const context = vm.createContext({ document, scrollX: 0, scrollY: 100 });
  // Through JSON, as Playwright returns it, since the context's objects have prototypes of their own.
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(boxesExpression(["img", "video", "["]), context))), {
    img: [{ x: 10, y: 120, width: 101, height: 51 }],
    video: [],
    "[": null,
  });
});

test("only images and media from another site count as remote", () => {
  const page = "http://127.0.0.1:5321";
  assert.equal(isRemoteMedia("image", "https://images.example.com/photo.jpg", page), true);
  assert.equal(isRemoteMedia("media", "http://cdn.example.com/clip.mp4", page), true);
  assert.equal(isRemoteMedia("image", "http://127.0.0.1:5321/@fs/ws/views/assets/photo.svg", page), false);
  assert.equal(isRemoteMedia("image", "data:image/svg+xml,%3Csvg%3E", page), false);
  assert.equal(isRemoteMedia("font", "https://fonts.gstatic.com/s/inter.woff2", page), false);
  assert.equal(isRemoteMedia("stylesheet", "https://fonts.googleapis.com/css2?family=Inter", page), false);
});
