/*
 * Capturing views for verification: each screen of a view is photographed at fixed sizes, and the implementation
 * of the feature is later checked against those screenshots pixel for pixel. Shared by the capture page (which
 * renders one screen) and the server (which takes the screenshots).
 */

import { DEFAULT_WIDTHS, widthList } from "./widths.ts";

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

/** The widths of a flow without its own, in a project that kept Basis' widths (the project's own replace them). */
export const DEFAULT_CAPTURE_WIDTHS = widthList(DEFAULT_WIDTHS);

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

/**
 * The screenshots a flow block asks for, with the defaults filled in and nonsense left out. `defaultWidths` are the
 * project's widths, for a flow that names none.
 */
export function captureShots(
  options: CaptureOptions | undefined,
  defaultWidths: number[] = DEFAULT_CAPTURE_WIDTHS,
): CaptureShot[] {
  const widths = [...new Set((options?.widths?.length ? options.widths : defaultWidths).map(Math.round))]
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
  /** The default widths the list was made with: a flow without its own `capture` widths gets these. */
  widths: number[];
}

/**
 * The capture page's `?list` query, with the project's widths as the defaults for flows without their own
 * (`&widths=390,768,1440`); the page reads them back with `listWidths`.
 */
export function listQuery(widths: number[]): string {
  return `?list&widths=${widths.join(",")}`;
}

/** The default widths a `?list` query names, or Basis' own when it names none that can be used. */
export function listWidths(param: string | null): number[] {
  const widths = (param ?? "")
    .split(",")
    .map(Number)
    .filter((width) => Number.isInteger(width) && width >= MIN_SIZE && width <= MAX_SIZE);
  return widths.length ? widths : DEFAULT_CAPTURE_WIDTHS;
}

/** The verification kit's folder in the product repo, and the folder inside its zip, unless another is chosen. */
export const KIT_FOLDER = "basis-verify";

/**
 * A folder for a kit, relative to the product repo's root with `/` between names (`basis-verify/web-12`), or null
 * when it is not one: empty, absolute, with `..`, or with names of other characters than letters, digits, `.`,
 * `_` and `-`. At most four names deep.
 */
export function kitFolder(text: string): string | null {
  const names = text.trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  if (names.length > 4) return null;
  return names.every((name) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) ? names.join("/") : null;
}

/** The kit folder Basis suggests for one view: its own folder under basis-verify/, so kits of views never meet. */
export function viewKitFolder(view: string): string {
  return `${KIT_FOLDER}/${view}`;
}

/** The attribute the capture page sets on <html> once a screen has settled and can be photographed. */
export const READY_ATTRIBUTE = "data-basis-ready";
