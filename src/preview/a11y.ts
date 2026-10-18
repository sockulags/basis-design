import type { NodeResult } from "axe-core";
import { LAYOUT_CHECK } from "../../shared/layout.ts";
import { setChecking, setFindings } from "./errors.ts";
import gallery from "./Gallery.module.css";
import { layoutFindings } from "./layout.ts";

/**
 * Checks of what the agent made, over the live demos (elements marked with CHECKED, named after their section)
 * once the preview has settled. Accessibility: axe-core's serious and critical WCAG A/AA violations. Layout (see
 * layout.ts): content wider than its frame, clipped text and small targets. Past versions, Basis' own sections and
 * offscreen copies are never marked, so they are never checked. The other theme is checked by a hidden copy of the
 * preview (see ThemeChecker in main.tsx), whose findings join this document's; every finding names the theme it
 * was found in.
 */

/** Marks a live demo the checks cover; the value names it in findings. */
export const CHECKED = "data-checked";

const CHECKS = ["Accessibility", LAYOUT_CHECK] as const;
type Check = (typeof CHECKS)[number];
const MAX_FINDINGS: Record<Check, number> = { Accessibility: 25, Layout: 15 };
/** This document's run, and the hidden copy's, kept apart so the fix loop waits for both. */
const RUN = "Checks of the demos";
const OTHER_THEME = "Checks of the demos in the other theme";
/** Quiet time before a run, so a burst of hot updates or progressive steps costs one run. */
const DELAY_MS = 600;
/** The gallery's own labels inside the demos (group titles, column heads, captions) are Basis', not the agent's. */
const GALLERY_LABELS = [gallery.groupTitle, gallery.colHead, gallery.caption].map((name) => `.${name}`).join(", ");

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
/** This document's findings by check, and the ones the copy in the other theme reported, as the preview lists them. */
let own: Record<Check, string[]> = { Accessibility: [], Layout: [] };
let other: string[] = [];
const ownListeners = new Set<(findings: string[], running: boolean) => void>();

function publish(): void {
  // With both themes shown in the gallery, the two documents find the same things; list them once.
  for (const check of CHECKS) {
    const prefix = `${check}: `;
    const theirs = other.filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length));
    setFindings(check, [...new Set([...own[check], ...theirs])].slice(0, MAX_FINDINGS[check]));
  }
}

/** This document's findings, each led by its check's name, the way the preview reports them to the chrome. */
function listed(): string[] {
  return CHECKS.flatMap((check) => own[check].map((item) => `${check}: ${item}`));
}

function setOwn(findings: Record<Check, string[]> | null, running: boolean): void {
  if (findings) {
    own = findings;
    publish();
  }
  setChecking(RUN, running);
  for (const listener of ownListeners) listener(listed(), running);
}

/** What the copy in the other theme found (each led by its check's name); it reports again whenever it runs. */
export function setOtherThemeFindings(findings: string[], running: boolean): void {
  other = findings;
  publish();
  setChecking(OTHER_THEME, running);
}

/** This document's own findings and whether its checks run, for the copy to pass on to the preview. */
export function onOwnFindings(listener: (findings: string[], running: boolean) => void): () => void {
  ownListeners.add(listener);
  return () => ownListeners.delete(listener);
}

/** Asks for the checks soon; the fix loop waits for them, so they report as running from now on. */
export function scheduleDemoChecks(): void {
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
    if (roots.length) {
      const { accessibility, targets } = await axeFindings(roots);
      own = { Accessibility: accessibility, Layout: layoutFindings(roots, targets) };
    } else {
      own = { Accessibility: [], Layout: [] };
    }
    publish();
  } catch (error) {
    console.warn("[basis] checks of the demos failed", error);
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleDemoChecks();
    } else {
      setOwn(own, false);
    }
  }
}

/** axe's accessibility findings, and the nodes of its target-size rule, which the layout check reports. */
async function axeFindings(roots: Element[]): Promise<{ accessibility: string[]; targets: NodeResult[] }> {
  const { default: axe } = await import("axe-core");
  const results = await axe.run(
    { include: roots, exclude: [...document.querySelectorAll(GALLERY_LABELS)] },
    {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      rules: {
        // The gallery shows the same demo several times (widths, review panes), so ids repeat by design.
        "duplicate-id": { enabled: false },
        "duplicate-id-active": { enabled: false },
        "duplicate-id-aria": { enabled: false },
        // Off by default in axe; its findings go to the layout check.
        "target-size": { enabled: true },
      },
      resultTypes: ["violations"],
      elementRef: true,
    },
  );
  // One finding per demo, theme and rule, so the text stays the same while the problem does (the fix loop
  // compares it), whichever of the two documents found it.
  const byKey = new Map<string, string>();
  const targets: NodeResult[] = [];
  for (const violation of results.violations) {
    if (violation.id === "target-size") {
      targets.push(...violation.nodes);
      continue;
    }
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
  return { accessibility: [...byKey.values()], targets };
}
