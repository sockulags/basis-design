/**
 * The pure parts of the preview's layout check (src/preview/layout.ts): what counts as content past a frame's
 * edge or as clipped text, which element a finding names, and how a finding reads. The preview measures; these
 * decide, so they can be tested without a browser.
 */

/** A box in viewport coordinates, as getBoundingClientRect gives it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The name the preview reports layout findings under ("Layout: ..."), so the fix loop can tell them apart. */
export const LAYOUT_CHECK = "Layout";

export type LayoutRule = "overflow" | "clipped" | "target-size";

/** The widths the gallery's frames show demos at, in px; "fit" is the gallery column's own width. */
export type FrameWidth = number | "fit";

/** Sub-pixel layout and antialiasing put edges a fraction past where they should be. */
const EDGE_TOLERANCE = 1;

/** Whether a box reaches past the frame's left or right edge. */
export function sticksOut(box: Box, frame: Box): boolean {
  return box.right > frame.right + EDGE_TOLERANCE || box.left < frame.left - EDGE_TOLERANCE;
}

/**
 * Whether a line of text (one rect of a text node) is cut off by a box that clips on the given axes. Sideways,
 * any real cut counts. Vertically a cut of up to a quarter of the line is left alone: a tight line height puts
 * the glyphs' extent a little past the box without anything going missing.
 */
export function textCut(line: Box, box: Box, axes: { x: boolean; y: boolean }): boolean {
  if (line.right <= line.left || line.bottom <= line.top) return false;
  if (axes.x && (line.right > box.right + 2 || line.left < box.left - 2)) return true;
  if (!axes.y) return false;
  const hidden = Math.max(0, line.bottom - box.bottom) + Math.max(0, box.top - line.top);
  return hidden > Math.max(2, (line.bottom - line.top) / 4);
}

/**
 * The element a finding names: the first offender (in document order) that holds no other offender, so the
 * finding points at what sticks out rather than at every wrapper that grew around it.
 */
export function innermost<T>(offenders: readonly T[], contains: (outer: T, inner: T) => boolean): T | undefined {
  return offenders.find((outer) => !offenders.some((inner) => inner !== outer && contains(outer, inner)));
}

/** An element's start tag, collapsed and cut short, so findings stay readable and the same while it does. */
export function startTag(outerHtml: string): string {
  const end = outerHtml.indexOf(">");
  const tag = end === -1 ? outerHtml : outerHtml.slice(0, end + 1);
  return tag.replace(/\s+/g, " ").slice(0, 120);
}

/** Where a frame is, in words: the width a demo was shown at. */
export function atWidth(width: FrameWidth): string {
  return width === "fit" ? "at the gallery's full width" : `at ${width}px`;
}

const RULES: Record<LayoutRule, string> = {
  overflow: "content does not fit the frame: it runs past an edge or scrolls sideways",
  clipped: "text is cut off by overflow: hidden or clip, with no ellipsis or line clamp",
  "target-size": "a control is smaller than 24 by 24px and too close to others (WCAG 2.5.8)",
};

/**
 * One finding: the demo (its section's title), theme, width, what is wrong and an example. One per demo, theme,
 * width and rule, and without measurements, so the text stays the same while the problem does (the fix loop
 * compares it to what was there before the turn).
 */
export function layoutFinding(where: string, theme: string, width: FrameWidth, rule: LayoutRule, example: string) {
  return `${where}, ${theme}, ${atWidth(width)}: ${RULES[rule]}, for example ${example}`;
}
