import type { Design } from "../shared/design.ts";
import { reachedSpecimens } from "./reach.ts";
import type { RepeatedShot, Screenshots } from "./screenshots.ts";
import { compareImages, decodePng } from "./verify-kit/compare.mjs";

/*
 * Whether views render the same every time. The verification kit holds an implementation to its screens pixel for
 * pixel, so a screen that shows the clock, random values or an animation that does not settle can never pass it.
 * After a turn that changed files in views/, the fix loop photographs every screen of the views those files reach
 * twice, the second time with the clock moved on, and reports the screens whose images differ as problems.
 */

/** A file in views/, whose changes the check looks at. */
export function isViewFile(file: string): boolean {
  return file.startsWith("views/");
}

/** A screen the check found wrong: its view's specimen file and the problem as the fix loop sends it. */
export interface ScreenFinding {
  file: string;
  /** The view's title, which the preview's render errors name it by. */
  view: string;
  kind: "unstable" | "failed";
  text: string;
}

/** True when two screenshots have the same size and the same pixels; the kit's own comparison decides. */
export function sameImage(first: Buffer, second: Buffer): boolean {
  if (first.equals(second)) return true;
  const result = compareImages(decodePng(first), decodePng(second));
  return result.sameSize && result.differing === 0;
}

/**
 * The problems in a set of repeated shots. The text names the screen, the view, its file and the width and theme,
 * and nothing that changes between two runs (no pixel counts), so it stays the same while the problem does.
 */
export function screenFindings(shots: RepeatedShot[]): ScreenFinding[] {
  const findings: ScreenFinding[] = [];
  for (const { view, screen, shot, first, second, error } of shots) {
    const where = `Screen "${screen.label}" (${screen.id}) of view "${view.title}" (${view.file})`;
    const at = `at ${shot.width}px${shot.theme === "dark" ? " in dark" : ""}`;
    if (error !== null) {
      findings.push({
        file: view.file,
        view: view.title,
        kind: "failed",
        text: `${where} fails to render ${at}: ${error}`,
      });
    } else if (!sameImage(first, second)) {
      findings.push({
        file: view.file,
        view: view.title,
        kind: "unstable",
        text: `${where} renders differently each time ${at}; look for clocks, random values or animations that do not settle.`,
      });
    }
  }
  return findings;
}

/**
 * Drops the failed screens the preview already reports: a view whose section fails in the gallery is named there
 * by its title (`<title> section: ...`), and the agent need not hear it twice. A screen further into the flow is
 * only rendered when someone clicks through, so the preview cannot report it.
 */
export function unreported(findings: ScreenFinding[], previewErrors: string[]): ScreenFinding[] {
  return findings.filter(
    (finding) =>
      finding.kind !== "failed" || !previewErrors.some((error) => error.startsWith(`${finding.view} section:`)),
  );
}

/** Checks the views a turn's changed files reach, for one open project's fix loop. */
export class ViewStability {
  /** Failures already written to the console, so a missing browser is said once rather than after every turn. */
  private readonly logged = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly screenshots: Pick<Screenshots, "repeat">,
    private readonly design: () => Design,
  ) {}

  /**
   * The problems of the views that `files` (workspace-relative, any in views/) reach through their imports. Never
   * throws: when the screenshots cannot be taken (no browser, a preview that does not compile) it finds nothing.
   */
  async check(files: string[]): Promise<ScreenFinding[]> {
    const changed = files.filter(isViewFile);
    if (!changed.length) return [];
    try {
      // With the design the same on both sides, only the files decide what is reached.
      const design = this.design();
      const reached = (await reachedSpecimens(this.dir, changed, design, design)) ?? [];
      const views = reached.filter(isViewFile);
      if (!views.length) return [];
      return screenFindings(await this.screenshots.repeat(views));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.logged.has(message)) {
        this.logged.add(message);
        console.warn(`[basis] could not check that views render the same every time: ${message}`);
      }
      return [];
    }
  }
}
