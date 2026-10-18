import { setChecking, setFindings } from "./errors.ts";
import gallery from "./Gallery.module.css";

/**
 * Accessibility check of what the agent made: axe-core runs over the live
 * demos (elements marked with CHECKED, named after their section) once the
 * preview has settled, and reports serious and critical WCAG A/AA violations
 * as findings. Past versions, Basis' own sections and offscreen copies are
 * never marked, so they are never checked. The other theme is checked by a
 * hidden copy of the preview (see ThemeChecker in main.tsx), whose findings
 * join this document's; every finding names the theme it was found in.
 */

/** Marks a live demo the check covers; the value names it in findings. */
export const CHECKED = "data-checked";

const CHECK = "Accessibility";
/** The hidden copy's run, kept apart so the fix loop also waits for it. */
const OTHER_THEME = "Accessibility in the other theme";
/** Quiet time before a run, so a burst of hot updates or progressive steps costs one run. */
const DELAY_MS = 600;
const MAX_FINDINGS = 25;
/** The gallery's own labels inside the demos (group titles, column heads, captions) are Basis', not the agent's. */
const GALLERY_LABELS = [gallery.groupTitle, gallery.colHead, gallery.caption].map((name) => `.${name}`).join(", ");

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
/** This document's findings, and the ones the copy in the other theme reported. */
let own: string[] = [];
let other: string[] = [];
const ownListeners = new Set<(findings: string[], running: boolean) => void>();

function publish(): void {
  // With both themes shown in the gallery, the two documents find the same things; list them once.
  setFindings(CHECK, [...new Set([...own, ...other])].slice(0, MAX_FINDINGS));
}

function setOwn(findings: string[] | null, running: boolean): void {
  if (findings) {
    own = findings;
    publish();
  }
  setChecking(CHECK, running);
  for (const listener of ownListeners) listener(own, running);
}

/** What the copy in the other theme found; it reports again whenever it runs. */
export function setOtherThemeFindings(findings: string[], running: boolean): void {
  other = findings;
  publish();
  setChecking(OTHER_THEME, running);
}

/** This document's own findings and whether its check runs, for the copy to pass on to the preview. */
export function onOwnFindings(listener: (findings: string[], running: boolean) => void): () => void {
  ownListeners.add(listener);
  return () => ownListeners.delete(listener);
}

/** Asks for a check soon; the fix loop waits for it, so it reports as running from now on. */
export function scheduleAccessibilityCheck(): void {
  setOwn(null, true);
  clearTimeout(timer);
  timer = setTimeout(() => void run(), DELAY_MS);
}

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const roots = [...document.querySelectorAll(`[${CHECKED}]`)];
    own = roots.length ? await findings(roots) : [];
    publish();
  } catch (error) {
    console.warn("[basis] accessibility check failed", error);
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleAccessibilityCheck();
    } else {
      setOwn(own, false);
    }
  }
}

async function findings(roots: Element[]): Promise<string[]> {
  const { default: axe } = await import("axe-core");
  const results = await axe.run(
    { include: roots, exclude: [...document.querySelectorAll(GALLERY_LABELS)] },
    {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      // The gallery shows the same demo several times (widths, review panes), so ids repeat by design.
      rules: {
        "duplicate-id": { enabled: false },
        "duplicate-id-active": { enabled: false },
        "duplicate-id-aria": { enabled: false },
      },
      resultTypes: ["violations"],
      elementRef: true,
    },
  );
  // One finding per demo, theme and rule, so the text stays the same while the problem does (the fix loop
  // compares it), whichever of the two documents found it.
  const byKey = new Map<string, string>();
  for (const violation of results.violations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") continue;
    for (const node of violation.nodes) {
      const element = node.element as Element | undefined;
      const where = element?.closest(`[${CHECKED}]`)?.getAttribute(CHECKED) ?? "Gallery";
      const theme = element?.closest("[data-theme]")?.getAttribute("data-theme") ?? "light";
      const key = `${where}|${theme}|${violation.id}`;
      if (byKey.has(key)) continue;
      const example = node.html.replace(/\s+/g, " ").slice(0, 120);
      byKey.set(key, `${where}, ${theme}: ${violation.help} (${violation.id}), for example ${example}`);
    }
  }
  return [...byKey.values()];
}
