import { createElement, type ComponentType } from "react";
import type { Design } from "../../shared/design.ts";
import { PAGES, type PageId } from "../../shared/frame.ts";
import type { ReviewTarget } from "../../shared/review.ts";
import type { Specimen, SpecimenBlock } from "../../template/components/specimen.ts";
import { Grid, Group, Matrix, Row, Section, Specimen as Labelled } from "./Gallery.tsx";

/**
 * Every `*.specimen.tsx` one folder deep in the workspace. "@workspace"
 * resolves to the workspace in the preview Vite config; adding, editing or
 * deleting a specimen file hot-updates the gallery. The folder decides the
 * page (see PAGES); specimens in other folders are ignored. Glob keys are
 * "@workspace/<folder>/<file>", or a relative path when the workspace lives
 * outside this repo, so the folder is always the second-to-last segment.
 */
type SpecimenModule = { default?: unknown };

const modules = import.meta.glob<SpecimenModule>("@workspace/*/*.specimen.tsx", { eager: true });

export interface LoadedSpecimen extends Specimen {
  id: string;
  group: string;
  order: number;
  file: string;
  page: PageId;
}

export interface SpecimenProblem {
  file: string;
  message: string;
}

const KINDS = new Set(["matrix", "grid", "row", "block"]);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isComponent(value: unknown): value is ComponentType<never> {
  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

/** Why a block cannot be rendered, or null when it is well formed. */
function blockProblem(block: unknown): string | null {
  if (!block || typeof block !== "object") return "a block is not an object";
  const b = block as Record<string, unknown>;
  if (!KINDS.has(b.kind as string)) return `unknown block kind "${String(b.kind)}" (use matrix, grid, row or block)`;
  if (b.kind === "matrix") {
    if (!Array.isArray(b.rows) || !Array.isArray(b.columns)) return "a matrix block needs rows and columns arrays";
    if (!isComponent(b.render)) return "a matrix block needs a render component";
  } else if (b.kind === "grid") {
    if (!Array.isArray(b.items)) return "a grid block needs an items array";
    if (b.items.some((item: unknown) => !item || !isComponent((item as { render?: unknown }).render))) {
      return "every grid item needs a label and a render component";
    }
  } else if (!isComponent(b.render)) {
    return `a ${String(b.kind)} block needs a render component`;
  }
  return null;
}

/** Reads every specimen module, keeping the valid specimens and describing the rest. */
export function loadSpecimens(): { specimens: LoadedSpecimen[]; problems: SpecimenProblem[] } {
  const specimens: LoadedSpecimen[] = [];
  const problems: SpecimenProblem[] = [];
  const seen = new Set<string>();
  const entries = Object.entries(modules).flatMap(([key, module]) => {
    const parts = key.split("/");
    const folder = parts.at(-2) ?? "";
    const name = parts.at(-1) ?? key;
    const page = PAGES.find((item) => item.folder === folder)?.id;
    return page ? [{ page, module, file: `${folder}/${name}` }] : [];
  });
  for (const { page, module, file } of entries) readModule(module, file, page, seen, specimens, problems);
  // Order decides placement; groups appear where their first specimen does.
  specimens.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { specimens, problems };
}

/** Adds the valid specimens of one module to `specimens` and describes the rest in `problems`. */
function readModule(
  module: SpecimenModule,
  file: string,
  page: PageId,
  seen: Set<string>,
  specimens: LoadedSpecimen[],
  problems: SpecimenProblem[],
): void {
  const exported = module.default;
  if (exported === undefined) {
    problems.push({ file, message: "has no default export (export default defineSpecimen({ ... }))" });
    return;
  }
  for (const candidate of Array.isArray(exported) ? exported : [exported]) {
    const raw = candidate as Partial<Specimen> | null;
    if (!raw || typeof raw.title !== "string" || !Array.isArray(raw.blocks)) {
      problems.push({ file, message: "default export must be a specimen with a title and a blocks array" });
      continue;
    }
    const broken = raw.blocks.map(blockProblem).find((problem) => problem !== null);
    if (broken) {
      problems.push({ file, message: `"${raw.title}": ${broken}` });
      continue;
    }
    let id = raw.id && /^[a-z0-9-]+$/.test(raw.id) ? raw.id : slug(raw.title) || "section";
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    specimens.push({
      ...raw,
      id,
      title: raw.title,
      blocks: raw.blocks as SpecimenBlock[],
      group: typeof raw.group === "string" && raw.group ? raw.group : page === "patterns" ? "Patterns" : "Components",
      order: typeof raw.order === "number" ? raw.order : 1000,
      file,
      page,
    });
  }
}

/**
 * The same specimen in a past version of the workspace, imported from its
 * snapshot copy (`base` is the copy's URL path). Resolves to null when the
 * file or the specimen did not exist then; rejects when it fails to load.
 */
export async function loadPastSpecimen(base: string, live: LoadedSpecimen): Promise<LoadedSpecimen | null> {
  let module: SpecimenModule;
  try {
    module = (await import(/* @vite-ignore */ `${base}/${live.file}`)) as SpecimenModule;
  } catch (error) {
    // A file that did not exist in that version is a 404, not a failure of its code.
    const response = await fetch(`${base}/${live.file}`, { method: "HEAD" }).catch(() => null);
    if (response?.status === 404) return null;
    throw error;
  }
  const specimens: LoadedSpecimen[] = [];
  readModule(module, live.file, live.page, new Set(), specimens, []);
  return specimens.find((item) => item.id === live.id) ?? specimens.find((item) => item.title === live.title) ?? null;
}

/**
 * Today's version of a specimen running on the starting point's components:
 * the preview server serves today's file at `<base>/<file>.basis-now.tsx`, with
 * its relative imports resolved inside the snapshot (see server/rebase.ts).
 * `version` changes after every hot update so an edited specimen loads afresh.
 * Resolves to null when it cannot run there (say, it imports a new component).
 */
export async function loadRebasedSpecimen(base: string, live: LoadedSpecimen, version: number): Promise<LoadedSpecimen | null> {
  let module: SpecimenModule;
  try {
    module = (await import(/* @vite-ignore */ `${base}/${live.file.replace(/\.tsx$/, ".basis-now.tsx")}?v=${version}`)) as SpecimenModule;
  } catch {
    return null;
  }
  const specimens: LoadedSpecimen[] = [];
  readModule(module, live.file, live.page, new Set(), specimens, []);
  return specimens.find((item) => item.id === live.id) ?? specimens.find((item) => item.title === live.title) ?? null;
}

function Block({ block, design }: { block: SpecimenBlock; design: Design }) {
  switch (block.kind) {
    case "matrix": {
      const rows = block.rows.map((label) => ({ id: label, label }));
      const columns = block.columns.map((label) => ({ id: label, label }));
      return (
        <Matrix
          rows={rows}
          cols={columns}
          minCol={block.minColumn}
          render={(row, column) => createElement(block.render, { row, column, design })}
        />
      );
    }
    case "grid":
      return (
        <Grid min={block.min}>
          {block.items.map((item, index) => (
            <Labelled key={`${item.label}-${index}`} label={item.label}>
              {createElement(item.render, { design })}
            </Labelled>
          ))}
        </Grid>
      );
    case "row":
      return <Row>{createElement(block.render, { design })}</Row>;
    case "block":
      return <>{createElement(block.render, { design })}</>;
  }
}

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
export function narrowSpecimen(specimen: LoadedSpecimen, target: ReviewTarget): { specimen: LoadedSpecimen } | { problem: string } {
  let blocks = specimen.blocks.map((block, index) => ({ block, index }));
  if (target.block) {
    const wanted = target.block;
    const number = /^\d+$/.test(wanted) ? Number(wanted) - 1 : -1;
    blocks = blocks.filter(({ block, index }) => index === number || (block.title !== undefined && same(block.title, wanted)));
    if (blocks.length === 0) {
      const names = specimen.blocks.map((block, index) => `"${blockName(block, index)}"`).join(", ");
      return { problem: `"${specimen.title}" has no block "${wanted}". Its blocks: ${names} (untitled ones by number, "1" is the first).` };
    }
  }
  const rows = target.rows ?? [];
  const columns = target.columns ?? [];
  if (rows.length === 0 && columns.length === 0) return { specimen: { ...specimen, blocks: blocks.map(({ block }) => block) } };
  const keep = (labels: string[], wanted: string[]) => (wanted.length ? labels.filter((label) => wanted.some((item) => same(item, label))) : labels);
  const narrowed: SpecimenBlock[] = [];
  const available: string[] = [];
  for (const { block, index } of blocks) {
    if (block.kind === "matrix") {
      const next = { ...block, rows: keep(block.rows, rows), columns: keep(block.columns, columns) };
      if (next.rows.length && next.columns.length) narrowed.push(next);
      else available.push(`"${blockName(block, index)}" has rows ${quoted(block.rows)} and columns ${quoted(block.columns)}`);
    } else if (block.kind === "grid") {
      const items = rows.length ? block.items.filter((item) => rows.some((label) => same(label, item.label))) : block.items;
      if (items.length && columns.length === 0) narrowed.push({ ...block, items });
      else available.push(`"${blockName(block, index)}" has items ${quoted(block.items.map((item) => item.label))}`);
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

/** The blocks of a specimen, without the section frame. */
export function SpecimenBlocks({ specimen, design }: { specimen: LoadedSpecimen; design: Design }) {
  return (
    <>
      {specimen.blocks.map((block, index) =>
        block.title ? (
          <Group key={index} title={block.title}>
            <Block block={block} design={design} />
          </Group>
        ) : (
          <Block key={index} block={block} design={design} />
        ),
      )}
    </>
  );
}

export function SpecimenSection({ specimen, design, onAsk }: { specimen: LoadedSpecimen; design: Design; onAsk: (prefix: string) => void }) {
  return (
    <Section id={specimen.id} title={specimen.title} description={specimen.description ?? ""} onAsk={onAsk}>
      <SpecimenBlocks specimen={specimen} design={design} />
    </Section>
  );
}
