import assert from "node:assert/strict";
import { test } from "node:test";
import { captureShots, shotFile, viewportHeightFor } from "../shared/capture.ts";
import { compareImages, decodePng, encodePng, exceptionsFor } from "../server/verify-kit/compare.mjs";

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
