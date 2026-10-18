import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { atWidth, innermost, layoutFinding, startTag, sticksOut, textCut, type Box } from "../shared/layout.ts";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const frame = box(0, 0, 343, 800);

describe("layout check", () => {
  test("content past either edge of the frame sticks out, within a pixel does not", () => {
    assert.equal(sticksOut(box(16, 0, 512, 40), frame), true);
    assert.equal(sticksOut(box(-20, 0, 100, 40), frame), true);
    assert.equal(sticksOut(box(0, 0, 343.6, 40), frame), false);
    assert.equal(sticksOut(box(-0.5, 0, 343, 40), frame), false);
  });

  test("text cut off sideways counts only when the box clips sideways", () => {
    const button = box(0, 0, 60, 40);
    const label = box(12, 10, 104, 30);
    assert.equal(textCut(label, button, { x: true, y: false }), true);
    assert.equal(textCut(label, button, { x: false, y: true }), false);
    assert.equal(textCut(box(12, 10, 61, 30), button, { x: true, y: false }), false);
  });

  test("a line cut vertically counts, glyphs a little past a tight box do not", () => {
    const cell = box(0, 0, 200, 40);
    assert.equal(textCut(box(0, 30, 120, 50), cell, { x: false, y: true }), true);
    assert.equal(textCut(box(0, 44, 120, 64), cell, { x: false, y: true }), true);
    assert.equal(textCut(box(0, 22, 120, 43), cell, { x: false, y: true }), false);
    assert.equal(textCut(box(0, 44, 120, 64), cell, { x: true, y: false }), false);
  });

  test("an empty line is never cut", () => {
    assert.equal(textCut(box(300, 300, 300, 320), frame, { x: true, y: true }), false);
  });

  test("the example is the first offender that holds no other", () => {
    // A wrapper grew around a table; the table grew around its rows.
    const tree: Record<string, string[]> = { wrapper: ["table", "row"], table: ["row"], row: [], badge: [] };
    const contains = (outer: string, inner: string) => tree[outer]!.includes(inner);
    assert.equal(innermost(["wrapper", "table", "row", "badge"], contains), "row");
    assert.equal(innermost(["badge", "wrapper", "row"], contains), "badge");
    assert.equal(innermost([], contains), undefined);
  });

  test("an element is named by its start tag, collapsed and cut short", () => {
    assert.equal(startTag('<div\n   class="_scroll_1">\n<table></table></div>'), '<div class="_scroll_1">');
    assert.equal(startTag(`<span title="${"x".repeat(200)}">`).length, 120);
  });

  test("findings name the demo, theme and width, without measurements", () => {
    assert.equal(atWidth(375), "at 375px");
    assert.equal(atWidth("fit"), "at the gallery's full width");
    assert.equal(
      layoutFinding("Team members", "dark", 375, "overflow", '<div class="_scroll_1">'),
      'Team members, dark, at 375px: content does not fit the frame: it runs past an edge or scrolls sideways, for example <div class="_scroll_1">',
    );
    assert.match(layoutFinding("Buttons", "light", "fit", "target-size", "<button>"), /WCAG 2\.5\.8/);
  });
});
