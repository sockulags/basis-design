/*
 * Capturing views for verification: each screen of a view is photographed at fixed sizes, and the implementation
 * of the feature is later checked against those screenshots pixel for pixel. Shared by the capture page (which
 * renders one screen) and the server (which takes the screenshots).
 */

export type CaptureTheme = "light" | "dark";

/** What a flow block may say about capturing (template/components/specimen.ts, `Capture`). */
export interface CaptureOptions {
  widths?: number[];
  height?: "full" | number;
  themes?: CaptureTheme[];
}

/** One screenshot of one screen. */
export interface CaptureShot {
  width: number;
  /** The viewport's height. With `fullPage` the image is as tall as the page; without, exactly this tall. */
  viewportHeight: number;
  fullPage: boolean;
  theme: CaptureTheme;
}

export const DEFAULT_CAPTURE_WIDTHS = [375, 768, 1440];

/**
 * The viewport height that goes with a width, for full-page captures too: elements sized in vh (an app shell,
 * a full-height hero) take it, so the design and the implementation must be photographed with the same one.
 */
export function viewportHeightFor(width: number): number {
  if (width <= 480) return 812;
  if (width <= 1024) return 1024;
  return 900;
}

const MIN_SIZE = 200;
const MAX_SIZE = 4000;

/** The screenshots a flow block asks for, with Basis' defaults filled in and nonsense left out. */
export function captureShots(options: CaptureOptions | undefined): CaptureShot[] {
  const widths = [...new Set((options?.widths?.length ? options.widths : DEFAULT_CAPTURE_WIDTHS).map(Math.round))]
    .filter((width) => width >= MIN_SIZE && width <= MAX_SIZE)
    .sort((a, b) => a - b);
  const themes = [...new Set(options?.themes?.length ? options.themes : (["light"] as CaptureTheme[]))].filter(
    (theme) => theme === "light" || theme === "dark",
  );
  const fixed = typeof options?.height === "number" ? Math.round(options.height) : null;
  const height = fixed !== null && fixed >= MIN_SIZE && fixed <= MAX_SIZE ? fixed : null;
  return themes.flatMap((theme) =>
    widths.map((width) => ({
      width,
      viewportHeight: height ?? viewportHeightFor(width),
      fullPage: height === null,
      theme,
    })),
  );
}

/** The file name of a shot inside the kit: "screens/<view>/<screen>@<width>[-dark].png". */
export function shotFile(view: string, screen: string, shot: CaptureShot): string {
  const theme = shot.theme === "light" ? "" : `-${shot.theme}`;
  const height = shot.fullPage ? "" : `x${shot.viewportHeight}`;
  return `screens/${view}/${screen}@${shot.width}${height}${theme}.png`;
}

/** What the capture page reports about the views it can render (`?list`). */
export interface CaptureView {
  id: string;
  title: string;
  /** The specimen file it comes from, workspace-relative (`views/Team.specimen.tsx`). */
  file: string;
  screens: { id: string; label: string; shots: CaptureShot[] }[];
}

/** A specimen the capture page can render alone (`?specimen=<id>`): a component's, a pattern's or a view's. */
export interface CaptureSpecimen {
  id: string;
  title: string;
  page: string;
}

/** Everything the capture page can render, as `?list` reports it (window.__basisCapture). */
export interface CaptureList {
  specimens: CaptureSpecimen[];
  views: CaptureView[];
  problems: string[];
}

/** The verification kit's folder in the product repo, and the folder inside its zip. */
export const KIT_FOLDER = "basis-verify";

/** The attribute the capture page sets on <html> once a screen has settled and can be photographed. */
export const READY_ATTRIBUTE = "data-basis-ready";
