import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_WIDTHS, parseWidths, type Widths } from "../shared/widths.ts";

/*
 * The project's widths for Mobile, Tablet and Desktop (shared/widths.ts), in .basis/widths.json: Basis' own file,
 * which the agent reads from each turn's context rather than edits, and outside git, so restoring a past version
 * or discarding a review leaves the widths as the user chose them. A workspace without the file (or with one that
 * does not hold a usable set) has Basis' defaults.
 */

const widthsFile = (dir: string) => path.join(dir, ".basis", "widths.json");

/** The widths saved in a workspace, or Basis' defaults. */
export async function readWidths(dir: string): Promise<Widths> {
  try {
    return parseWidths(JSON.parse(await readFile(widthsFile(dir), "utf8"))) ?? DEFAULT_WIDTHS;
  } catch {
    return DEFAULT_WIDTHS;
  }
}

/** Saves a workspace's widths; null removes the setting, so the workspace has Basis' defaults again. */
export async function saveWidths(dir: string, widths: Widths | null): Promise<void> {
  const file = widthsFile(dir);
  if (!widths) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(widths, null, 2)}\n`);
}

/** Gives a copied project the widths of the project it was copied from, when that one has its own. */
export async function copyWidths(from: string, to: string): Promise<void> {
  const text = await readFile(widthsFile(from), "utf8").catch(() => null);
  const widths = text === null ? null : parseWidths(JSON.parse(text));
  if (widths) await saveWidths(to, widths);
}
