import type { ReviewTarget } from "../../shared/review.ts";
import type { SpecimenBlock } from "../../template/components/specimen.ts";
import type { LoadedSpecimen } from "./specimens.tsx";

/*
 * Resolving review targets against specimens. Pure functions (no React), so
 * they run in tests as well as in the preview.
 */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const quoted = (labels: string[]) => labels.map((label) => `"${label}"`).join(", ");

/** The specimen a review target names, by id or title (case does not matter). */
export function findSpecimen(specimens: LoadedSpecimen[], name: string): LoadedSpecimen | undefined {
  return specimens.find((specimen) => specimen.id === name || same(specimen.title, name));
}

/** "Sizes", or "block 1" for a block without a title. */
function blockName(block: SpecimenBlock, index: number): string {
  return block.title ?? `block ${index + 1}`;
}

/**
 * The part of a specimen a review target asks for. `block` picks one block by
 * title or 1-based number; `rows` and `columns` keep only those matrix rows and
 * columns or grid items, and drop blocks where none of them appear. Returns a
 * problem phrased for the agent when nothing matches.
 */
export function narrowSpecimen(
  specimen: LoadedSpecimen,
  target: ReviewTarget,
): { specimen: LoadedSpecimen } | { problem: string } {
  let blocks = specimen.blocks.map((block, index) => ({ block, index }));
  if (target.block) {
    const wanted = target.block;
    const number = /^\d+$/.test(wanted) ? Number(wanted) - 1 : -1;
    blocks = blocks.filter(
      ({ block, index }) => index === number || (block.title !== undefined && same(block.title, wanted)),
    );
    if (blocks.length === 0) {
      const names = specimen.blocks.map((block, index) => `"${blockName(block, index)}"`).join(", ");
      return {
        problem: `"${specimen.title}" has no block "${wanted}". Its blocks: ${names} (untitled ones by number, "1" is the first).`,
      };
    }
  }
  const rows = target.rows ?? [];
  const columns = target.columns ?? [];
  if (rows.length === 0 && columns.length === 0)
    return { specimen: { ...specimen, blocks: blocks.map(({ block }) => block) } };
  const keep = (labels: string[], wanted: string[]) =>
    wanted.length ? labels.filter((label) => wanted.some((item) => same(item, label))) : labels;
  const narrowed: SpecimenBlock[] = [];
  const available: string[] = [];
  for (const { block, index } of blocks) {
    if (block.kind === "matrix") {
      const next = { ...block, rows: keep(block.rows, rows), columns: keep(block.columns, columns) };
      if (next.rows.length && next.columns.length) narrowed.push(next);
      else
        available.push(
          `"${blockName(block, index)}" has rows ${quoted(block.rows)} and columns ${quoted(block.columns)}`,
        );
    } else if (block.kind === "states") {
      const states = rows.length
        ? block.states.filter((state) => rows.some((label) => same(label, state.label)))
        : block.states;
      if (states.length && columns.length === 0) narrowed.push({ ...block, states });
      else
        available.push(`"${blockName(block, index)}" has states ${quoted(block.states.map((state) => state.label))}`);
    } else if (block.kind === "grid") {
      const items = rows.length
        ? block.items.filter((item) => rows.some((label) => same(label, item.label)))
        : block.items;
      if (items.length && columns.length === 0) narrowed.push({ ...block, items });
      else available.push(`"${blockName(block, index)}" has items ${quoted(block.items.map((item) => item.label))}`);
    } else if (block.kind === "flow") {
      // A view's screens go by label or id.
      const screens = rows.length
        ? block.screens.filter((screen) => rows.some((label) => same(label, screen.label) || same(label, screen.id)))
        : block.screens;
      if (screens.length && columns.length === 0) narrowed.push({ ...block, screens });
      else
        available.push(
          `"${blockName(block, index)}" has screens ${quoted(block.screens.map((screen) => screen.label))}`,
        );
    } else if (target.block) {
      // A free-form demo cannot be narrowed, but when it was named it is what the agent wants to show.
      narrowed.push(block);
    }
  }
  if (narrowed.length === 0) {
    return { problem: `nothing in "${specimen.title}" matches those rows and columns. ${available.join("; ")}.` };
  }
  return { specimen: { ...specimen, blocks: narrowed } };
}
