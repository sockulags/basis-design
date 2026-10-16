import { createElement, type ComponentType } from "react";
import type { Design } from "../../shared/design.ts";
import type { Specimen, SpecimenBlock } from "../../template/components/specimen.ts";
import { Grid, Group, Matrix, Row, Section, Specimen as Labelled } from "./Gallery.tsx";

/**
 * Every `*.specimen.tsx` in the workspace's components folder. "@components"
 * resolves to that folder in the preview Vite config; adding, editing or
 * deleting a specimen file hot-updates the gallery.
 */
const modules = import.meta.glob<{ default?: unknown }>("@components/*.specimen.tsx", { eager: true });

export interface LoadedSpecimen extends Specimen {
  id: string;
  group: string;
  order: number;
  file: string;
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
  for (const [path, module] of Object.entries(modules)) {
    const file = path.split("/").pop() ?? path;
    const exported = module.default;
    const list = Array.isArray(exported) ? exported : [exported];
    if (exported === undefined) {
      problems.push({ file, message: "has no default export (export default defineSpecimen({ ... }))" });
      continue;
    }
    for (const candidate of list) {
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
        group: typeof raw.group === "string" && raw.group ? raw.group : "Components",
        order: typeof raw.order === "number" ? raw.order : 1000,
        file,
      });
    }
  }
  specimens.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.title.localeCompare(b.title));
  return { specimens, problems };
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

export function SpecimenSection({ specimen, design, onAsk }: { specimen: LoadedSpecimen; design: Design; onAsk: (prefix: string) => void }) {
  return (
    <Section id={specimen.id} title={specimen.title} description={specimen.description ?? ""} onAsk={onAsk}>
      {specimen.blocks.map((block, index) =>
        block.title ? (
          <Group key={index} title={block.title}>
            <Block block={block} design={design} />
          </Group>
        ) : (
          <Block key={index} block={block} design={design} />
        ),
      )}
    </Section>
  );
}
