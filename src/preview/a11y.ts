import { setChecking, setFindings } from "./errors.ts";

/**
 * Accessibility check of what the agent made: axe-core runs over the live
 * demos (elements marked with CHECKED, named after their section) once the
 * preview has settled, and reports serious and critical WCAG A/AA violations
 * as findings. Past versions, Basis' own sections and offscreen copies are
 * never marked, so they are never checked.
 */

/** Marks a live demo the check covers; the value names it in findings. */
export const CHECKED = "data-checked";

const CHECK = "Accessibility";
/** Quiet time before a run, so a burst of hot updates or progressive steps costs one run. */
const DELAY_MS = 600;
const MAX_FINDINGS = 25;

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

/** Asks for a check soon; the fix loop waits for it, so it reports as running from now on. */
export function scheduleAccessibilityCheck(): void {
  setChecking(CHECK, true);
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
    setFindings(CHECK, roots.length ? await findings(roots) : []);
  } catch (error) {
    console.warn("[basis] accessibility check failed", error);
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleAccessibilityCheck();
    } else {
      setChecking(CHECK, false);
    }
  }
}

async function findings(roots: Element[]): Promise<string[]> {
  const { default: axe } = await import("axe-core");
  const results = await axe.run(
    { include: roots },
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
  // One finding per demo and rule, so the text stays the same while the problem does (the fix loop compares it).
  const byKey = new Map<string, string>();
  for (const violation of results.violations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") continue;
    for (const node of violation.nodes) {
      const element = node.element as Element | undefined;
      const where = element?.closest(`[${CHECKED}]`)?.getAttribute(CHECKED) ?? "Gallery";
      const key = `${where}|${violation.id}`;
      if (byKey.has(key)) continue;
      const example = node.html.replace(/\s+/g, " ").slice(0, 120);
      byKey.set(key, `${where}: ${violation.help} (${violation.id}), for example ${example}`);
    }
  }
  return [...byKey.values()].slice(0, MAX_FINDINGS);
}
