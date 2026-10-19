/*
 * The widths a project shows and checks its design at: Mobile, Tablet and Desktop, chosen per project (saved in
 * the workspace's `.basis/widths.json`, server/widths.ts). The gallery's Show at frames, the layout check, the
 * agent's screenshot tool, the stability check and the verification kit's default shots all take them.
 */

export interface Widths {
  mobile: number;
  tablet: number;
  desktop: number;
}

export type WidthName = keyof Widths;

/** What a project without the setting gets, as before widths could be chosen. */
export const DEFAULT_WIDTHS: Widths = { mobile: 375, tablet: 768, desktop: 1440 };

export const WIDTH_NAMES: WidthName[] = ["mobile", "tablet", "desktop"];

export const WIDTH_LABELS: Record<WidthName, string> = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop" };

/** The narrowest phone still sold, and a 4K screen. */
export const MIN_PROJECT_WIDTH = 280;
export const MAX_PROJECT_WIDTH = 3840;

/** Why a set of widths cannot be used, in a sentence for the user, or null when it can. */
export function widthsProblem(widths: Widths): string | null {
  for (const name of WIDTH_NAMES) {
    const value = widths[name];
    if (!Number.isInteger(value) || value < MIN_PROJECT_WIDTH || value > MAX_PROJECT_WIDTH) {
      return `${WIDTH_LABELS[name]} must be a whole number from ${MIN_PROJECT_WIDTH} to ${MAX_PROJECT_WIDTH}px.`;
    }
  }
  if (widths.mobile >= widths.tablet) return "Mobile must be narrower than Tablet.";
  if (widths.tablet >= widths.desktop) return "Tablet must be narrower than Desktop.";
  return null;
}

/** Widths from an untrusted source (a file, a message), or null when they are not a usable set. */
export function parseWidths(value: unknown): Widths | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const widths = { mobile: raw.mobile, tablet: raw.tablet, desktop: raw.desktop } as Widths;
  return widthsProblem(widths) === null ? widths : null;
}

/** The widths narrowest first, as the kit's default shots take them. */
export function widthList(widths: Widths): number[] {
  return WIDTH_NAMES.map((name) => widths[name]);
}

export function sameWidths(a: Widths, b: Widths): boolean {
  return WIDTH_NAMES.every((name) => a[name] === b[name]);
}

/** The widths in words, for the agent: "Mobile 390px, Tablet 768px and Desktop 1440px". */
export function describeWidths(widths: Widths): string {
  const named = WIDTH_NAMES.map((name) => `${WIDTH_LABELS[name]} ${widths[name]}px`);
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}
