export interface Image {
  width: number;
  height: number;
  data: Buffer;
}
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Exception {
  name: string;
  reason?: string;
  view: string;
  screen?: string;
  widths?: number[];
  themes?: string[];
  region?: Region;
  selector?: string | { design?: string; app?: string };
}
/** Each selector's boxes in one shot (`<shot>.boxes.json`); null for a selector that is not valid. */
export type Boxes = Record<string, Region[] | null>;
export const MEDIA_SELECTOR: string;
export function boxesFile(shotFile: string): string;
export function boxesExpression(selectors: string[]): string;
export function selectorFor(exception: Pick<Exception, "selector">, side: "design" | "app"): string | undefined;
export function selectorsFor(
  exceptions: Pick<Exception, "selector">[],
  side: "design" | "app",
  media?: string | null,
): string[];
export function shotExclusions(
  applying: Exception[],
  options?: { media?: string | null; expectedBoxes?: Boxes; actualBoxes?: Boxes; boxTolerance?: number },
): { regions: Region[]; names: string[]; problems: string[] };
export function decodePng(buffer: Buffer): Image;
export function encodePng(image: Image): Buffer;
export function compareImages(
  expected: Image,
  actual: Image,
  options?: { tolerance?: number; regions?: Region[] },
): {
  width: number;
  height: number;
  sameSize: boolean;
  differing: number;
  counted: number;
  percent: number;
  diff: Image;
};
export function exceptionsFor<T extends Exception>(
  exceptions: T[],
  shot: { view: string; screen: string; width: number; theme: string },
): T[];
