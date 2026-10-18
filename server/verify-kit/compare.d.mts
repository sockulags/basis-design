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
}
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
