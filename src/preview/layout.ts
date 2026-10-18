import type { NodeResult } from "axe-core";
import {
  innermost,
  layoutFinding,
  startTag,
  sticksOut,
  textCut,
  type Box,
  type FrameWidth,
  type LayoutRule,
} from "../../shared/layout.ts";
import { CHECKED } from "./a11y.ts";
import gallery from "./Gallery.module.css";

/**
 * Layout check of what the agent made, run with the accessibility check over the same marked demos (see a11y.ts).
 * Each demo is judged in its frame: the width the gallery shows it at (a Show at frame, marked with FRAME), or the
 * gallery column when it is not framed. Three rules: content wider than the frame, so that the frame or a box
 * inside the design scrolls sideways; text cut off by overflow without an ellipsis or a line clamp; and controls
 * smaller than 24 by 24 px with too little space around them (axe's target-size rule, which leaves out links in
 * running text). The gallery's own wrappers and scroll areas (the matrix that scrolls on a phone on purpose) are
 * never findings.
 */

/** Marks a frame a demo is shown in; the value is its width in px, or "fit" for the gallery column's width. */
export const FRAME = "data-frame";

const GALLERY_CLASSES = new Set(Object.values(gallery));
const SCROLLS = new Set(["auto", "scroll"]);
const CLIPS = new Set(["hidden", "clip"]);

function isGallery(element: Element): boolean {
  for (const name of element.classList) if (GALLERY_CLASSES.has(name)) return true;
  return false;
}

/** The inside of an element's border, where content may go without scrolling. */
function paddingBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  const left = rect.left + element.clientLeft;
  const top = rect.top + element.clientTop;
  return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
}

interface Frame {
  element: Element;
  where: string;
  theme: string;
  width: FrameWidth;
}

function frameWidth(element: Element): FrameWidth {
  const value = Number(element.getAttribute(FRAME));
  return Number.isFinite(value) && value > 0 ? value : "fit";
}

/** The frames a marked demo is shown in: its Show at frames, or the box around it (a section or a review pane). */
function framesOf(root: Element): Frame[] {
  const where = root.getAttribute(CHECKED) ?? "Gallery";
  const marked = [...root.querySelectorAll(`[${FRAME}]`)];
  const elements = marked.length ? marked : root.parentElement ? [root.parentElement] : [];
  return elements.map((element) => ({
    element,
    where,
    theme: element.closest("[data-theme]")?.getAttribute("data-theme") ?? "light",
    width: marked.length ? frameWidth(element) : "fit",
  }));
}

function describe(element: Element): string {
  return startTag(element.outerHTML);
}

/** What one frame shows wrong: content past its edges or scrolling sideways, and text cut off. */
function checkFrame(frame: Frame, add: (rule: LayoutRule, example: string) => void): void {
  const edges = paddingBox(frame.element);
  const outside: Element[] = [];
  const scrollers: Element[] = [];
  const clipped: string[] = [];
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element) => {
    let style = styles.get(element);
    if (!style) styles.set(element, (style = getComputedStyle(element)));
    return style;
  };

  // `contained`: inside a box that scrolls or clips, so it cannot push past the frame (that box is judged itself).
  const walk = (parent: Element, contained: boolean) => {
    for (const element of parent.children) {
      const style = styleOf(element);
      if (style.display === "none") continue;
      const own = !isGallery(element) && style.display !== "contents" && style.visibility === "visible";
      const fixed = style.position === "fixed";
      if (own && !fixed) {
        // Something invisible (a tooltip until hovered) is not seen past the edge.
        if (
          !contained &&
          sticksOut(element.getBoundingClientRect(), edges) &&
          element.checkVisibility({ opacityProperty: true })
        ) {
          outside.push(element);
        }
        // A box that scrolls sideways hides part of the design at this width. Scroll snapping marks a deliberate
        // carousel or strip, which is left alone.
        if (
          SCROLLS.has(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1 &&
          style.scrollSnapType === "none"
        ) {
          scrollers.push(element);
        }
        if (CLIPS.has(style.overflowX) || CLIPS.has(style.overflowY)) {
          const text = cutText(element, style, styleOf);
          if (text !== null) clipped.push(`"${text}" in ${describe(element)}`);
        }
      }
      if (element.namespaceURI === "http://www.w3.org/2000/svg") continue;
      walk(element, contained || fixed || style.overflowX !== "visible");
    }
  };
  walk(frame.element, false);

  const example = innermost(outside, (outer, inner) => outer.contains(inner)) ?? scrollers[0];
  if (example) add("overflow", describe(example));
  if (clipped[0]) add("clipped", clipped[0]);
}

/**
 * The first text a box cuts off, or null. Sideways clipping is fine with an ellipsis (text-overflow), vertical
 * clipping with a line clamp. Text inside a nearer box that scrolls or clips is that box's to judge, and boxes of
 * a pixel or less (visually hidden text, collapsed panels) are left out.
 */
function cutText(
  box: Element,
  style: CSSStyleDeclaration,
  styleOf: (element: Element) => CSSStyleDeclaration,
): string | null {
  if (box.clientWidth <= 1 || box.clientHeight <= 1 || style.clipPath !== "none") return null;
  const clamped = [style.getPropertyValue("-webkit-line-clamp"), style.getPropertyValue("line-clamp")].some(
    (value) => value !== "" && value !== "none",
  );
  const axes = {
    x: CLIPS.has(style.overflowX) && style.textOverflow === "clip" && box.scrollWidth > box.clientWidth + 1,
    y: CLIPS.has(style.overflowY) && !clamped && box.scrollHeight > box.clientHeight + 1,
  };
  if (!axes.x && !axes.y) return null;
  const edges = paddingBox(box);
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest("svg, select, textarea")) continue;
    if (!parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    if (nearestClip(parent, box, styleOf) !== box) continue;
    range.selectNodeContents(node);
    for (const line of range.getClientRects()) {
      if (textCut(line, edges, axes)) return text.slice(0, 40);
    }
  }
  return null;
}

/** The nearest element from `from` up to `box` that scrolls or clips its content. */
function nearestClip(from: Element, box: Element, styleOf: (element: Element) => CSSStyleDeclaration): Element {
  for (let element: Element | null = from; element && element !== box; element = element.parentElement) {
    const style = styleOf(element);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") return element;
  }
  return box;
}

/**
 * The layout findings of the marked demos: one per demo, theme, width and rule. `targets` are the nodes axe's
 * target-size rule found, which the accessibility check's run collects (axe runs one check at a time).
 */
export function layoutFindings(roots: Element[], targets: NodeResult[]): string[] {
  const byKey = new Map<string, string>();
  const frames = roots.flatMap(framesOf);
  for (const frame of frames) {
    if (frame.element.clientWidth === 0) continue;
    checkFrame(frame, (rule, example) => {
      const key = `${frame.where}|${frame.theme}|${frame.width}|${rule}`;
      if (!byKey.has(key)) byKey.set(key, layoutFinding(frame.where, frame.theme, frame.width, rule, example));
    });
  }
  for (const node of targets) {
    const element = node.element as Element | undefined;
    if (!element || isGallery(element)) continue;
    const frame = frames.find((item) => item.element.contains(element));
    if (!frame) continue;
    const key = `${frame.where}|${frame.theme}|${frame.width}|target-size`;
    const example = node.html.replace(/\s+/g, " ").slice(0, 120);
    if (!byKey.has(key)) byKey.set(key, layoutFinding(frame.where, frame.theme, frame.width, "target-size", example));
  }
  return [...byKey.values()];
}
