import {
  createContext,
  createElement,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import type { Design } from "../../shared/design.ts";
import { PAGES, type PageId } from "../../shared/frame.ts";
import { DEFAULT_WIDTHS, WIDTH_LABELS, WIDTH_NAMES, type WidthName, type Widths } from "../../shared/widths.ts";
import type { Specimen, SpecimenBlock } from "../../template/components/specimen.ts";
import { Flow, Grid, Group, Matrix, Row, Section, Specimen as Labelled, States } from "./Gallery.tsx";
import galleryStyles from "./Gallery.module.css";
import { CHECKED } from "./a11y.ts";
import { FRAME } from "./layout.ts";

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

const KINDS = new Set(["matrix", "grid", "states", "row", "block", "flow"]);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isComponent(value: unknown): value is ComponentType<never> {
  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

/** What is wrong with a flow block's `capture`, or null when it is absent or well formed. */
function captureProblem(capture: unknown): string | null {
  if (capture === undefined) return null;
  if (!capture || typeof capture !== "object") return "capture must be an object: { widths, height, themes }";
  const { widths, height, themes } = capture as Record<string, unknown>;
  if (widths !== undefined && (!Array.isArray(widths) || widths.some((width) => typeof width !== "number"))) {
    return "capture.widths must be an array of numbers (viewport widths in px)";
  }
  if (height !== undefined && height !== "full" && typeof height !== "number") {
    return 'capture.height must be "full" or a number (viewport height in px)';
  }
  if (
    themes !== undefined &&
    (!Array.isArray(themes) || themes.some((theme) => theme !== "light" && theme !== "dark"))
  ) {
    return 'capture.themes must be an array of "light" and "dark"';
  }
  return null;
}

/** Why a block cannot be rendered, or null when it is well formed. */
function blockProblem(block: unknown): string | null {
  if (!block || typeof block !== "object") return "a block is not an object";
  const b = block as Record<string, unknown>;
  if (!KINDS.has(b.kind as string))
    return `unknown block kind "${String(b.kind)}" (use matrix, grid, states, row, block or flow)`;
  if (b.kind === "matrix") {
    if (!Array.isArray(b.rows) || !Array.isArray(b.columns)) return "a matrix block needs rows and columns arrays";
    if (!isComponent(b.render)) return "a matrix block needs a render component";
  } else if (b.kind === "grid") {
    if (!Array.isArray(b.items)) return "a grid block needs an items array";
    if (b.items.some((item: unknown) => !item || !isComponent((item as { render?: unknown }).render))) {
      return "every grid item needs a label and a render component";
    }
  } else if (b.kind === "states") {
    if (!Array.isArray(b.states)) return "a states block needs a states array";
    if (b.states.some((state: unknown) => !state || !isComponent((state as { render?: unknown }).render))) {
      return "every state needs a label and a render component";
    }
  } else if (b.kind === "flow") {
    if (!Array.isArray(b.screens) || b.screens.length === 0) return "a flow block needs a screens array";
    const screens = b.screens as { id?: unknown; render?: unknown }[];
    if (screens.some((screen) => !screen || typeof screen.id !== "string" || !isComponent(screen.render))) {
      return "every screen needs an id, a label and a render component";
    }
    return captureProblem(b.capture);
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
    const base = raw.id && /^[a-z0-9-]+$/.test(raw.id) ? raw.id : slug(raw.title) || "section";
    // Repeats become base-2, base-3 ...: short enough for the chrome's 80-character limit on section ids.
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
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
export async function loadRebasedSpecimen(
  base: string,
  live: LoadedSpecimen,
  version: number,
): Promise<LoadedSpecimen | null> {
  let module: SpecimenModule;
  try {
    module = (await import(
      /* @vite-ignore */ `${base}/${live.file.replace(/\.tsx$/, ".basis-now.tsx")}?v=${version}`
    )) as SpecimenModule;
  } catch {
    return null;
  }
  const specimens: LoadedSpecimen[] = [];
  readModule(module, live.file, live.page, new Set(), specimens, []);
  return specimens.find((item) => item.id === live.id) ?? specimens.find((item) => item.title === live.title) ?? null;
}

function Block({ block, design, specimen }: { block: SpecimenBlock; design: Design; specimen: string }) {
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
    case "states":
      return (
        <States
          states={block.states.map((state) => ({
            label: state.label,
            content: createElement(state.render, { design }),
          }))}
        />
      );
    case "row":
      return <Row>{createElement(block.render, { design })}</Row>;
    case "block":
      return <>{createElement(block.render, { design })}</>;
    case "flow":
      return <FlowBlock screens={block.screens} design={design} specimen={specimen} />;
  }
}

export interface FlowPosition {
  id: string;
  data?: unknown;
}

/**
 * Lets several copies of a flow move together: the panes of one review target share it, so blinking or looking
 * side by side always compares the same screen. Without a provider each flow keeps its own place.
 */
export const FlowSync = createContext<{ position: FlowPosition | null; move: (next: FlowPosition) => void } | null>(
  null,
);

/**
 * Lets the gallery's flows open in full screen (see FullScreen.tsx). `left` is the view that last left full screen
 * and where its flow was then; every copy of that view's flow in the gallery moves there.
 */
export interface FlowsInFullScreen {
  open: (specimen: string, position: FlowPosition) => void;
  left: { specimen: string; position: FlowPosition } | null;
}

const FullScreen = createContext<FlowsInFullScreen | null>(null);

type Screens = Extract<SpecimenBlock, { kind: "flow" }>["screens"];

/** Every screen of a specimen's flows, in order, as the capture page lists a view's screens. */
export function flowScreens(specimen: LoadedSpecimen): Screens {
  return specimen.blocks.flatMap((block) => (block.kind === "flow" ? block.screens : []));
}

/** One screen of a flow at a time; screens move on with `go`, and the strip jumps anywhere. */
function FlowBlock({ screens, design, specimen }: { screens: Screens; design: Design; specimen: string }) {
  const shared = useContext(FlowSync);
  const fullScreen = useContext(FullScreen);
  const [own, setOwn] = useState<FlowPosition>({ id: screens[0]?.id ?? "" });
  const current = shared?.position ?? own;
  const move = shared?.move ?? setOwn;
  const screen = screens.find((item) => item.id === current.id) ?? screens[0];
  const go = useCallback((id: string, data?: unknown) => move({ id, data }), [move]);
  const left = fullScreen?.left;
  useEffect(() => {
    if (left?.specimen === specimen) setOwn(left.position);
  }, [left, specimen]);
  if (!screen) return null;
  return (
    <Flow
      screens={screens.map(({ id, label }) => ({ id, label }))}
      current={screen.id}
      onSelect={(id) => go(id)}
      onFullScreen={fullScreen ? () => fullScreen.open(specimen, { ...current, id: screen.id }) : undefined}
    >
      {createElement(screen.render, { design, go, data: current.data })}
    </Flow>
  );
}

export type FrameWidth = "fit" | WidthName;

/** The widths a block can be shown at: "fit" is the column's own width, the others the project's (ProjectWidths). */
export const FRAME_WIDTHS: { id: FrameWidth; label: string }[] = [
  { id: "fit", label: "Fit" },
  ...WIDTH_NAMES.map((name) => ({ id: name, label: WIDTH_LABELS[name] })),
];

/** The project's widths (PreviewView.widths), which the frames take; Preview provides them. */
export const ProjectWidths = createContext<Widths>(DEFAULT_WIDTHS);

/** How each block of a specimen is shown: at which widths, in the current theme or in both. */
export interface Frames {
  widths: FrameWidth[];
  bothThemes: boolean;
  theme: "light" | "dark";
  /** The review side the copies belong to, so they take that side's tokens. */
  side?: string;
}

const preventSubmit = (event: FormEvent) => event.preventDefault();

/**
 * A block at each chosen width and theme. Every copy is a size container (so a
 * pattern's @container rules respond to it) and a form of its own (so named
 * radio groups in the copies stay apart). A copy's content box is exactly the
 * width it is shown at; the frame's padding and border lie outside it.
 */
function Framed({
  block,
  design,
  frames,
  specimen,
}: {
  block: SpecimenBlock;
  design: Design;
  frames: Frames;
  specimen: string;
}) {
  const projectWidths = useContext(ProjectWidths);
  const themes = frames.bothThemes ? (["light", "dark"] as const) : [frames.theme];
  const widths = FRAME_WIDTHS.filter((width) => frames.widths.includes(width.id)).map((width) => ({
    ...width,
    px: width.id === "fit" ? undefined : projectWidths[width.id],
  }));
  return (
    <div className={galleryStyles.frames}>
      {widths.map((width) => (
        <div key={width.id} className={galleryStyles.frameRow}>
          {themes.map((theme) => (
            <figure key={theme} className={galleryStyles.frame}>
              <figcaption className={galleryStyles.caption}>
                {width.px ? `${width.label} · ${width.px}px` : width.label}
                {frames.bothThemes ? ` · ${theme}` : ""}
              </figcaption>
              <div className={galleryStyles.frameScroll} tabIndex={0}>
                <form
                  className={`ds-root ${galleryStyles.frameBody}`}
                  data-theme={theme}
                  data-side={frames.side}
                  data-fit={width.px ? undefined : true}
                  {...{ [FRAME]: width.px ?? "fit" }}
                  style={width.px ? { width: width.px } : undefined}
                  onSubmit={preventSubmit}
                >
                  <Block block={block} design={design} specimen={specimen} />
                </form>
              </div>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The blocks of a specimen, without the section frame; with `frames`, at several widths or in both themes. */
export function SpecimenBlocks({
  specimen,
  design,
  frames,
}: {
  specimen: LoadedSpecimen;
  design: Design;
  frames?: Frames;
}) {
  const framed = frames && (frames.bothThemes || frames.widths.some((width) => width !== "fit"));
  return (
    <>
      {specimen.blocks.map((block, index) => {
        const content = framed ? (
          <Framed block={block} design={design} frames={frames} specimen={specimen.id} />
        ) : (
          <Block block={block} design={design} specimen={specimen.id} />
        );
        return block.title ? (
          <Group key={index} title={block.title}>
            {content}
          </Group>
        ) : (
          <Fragment key={index}>{content}</Fragment>
        );
      })}
    </>
  );
}

export function SpecimenSection({
  specimen,
  design,
  onAsk,
  frames,
  fullScreen,
}: {
  specimen: LoadedSpecimen;
  design: Design;
  onAsk: (prefix: string) => void;
  frames?: Frames;
  /** The gallery's flows can open in full screen. */
  fullScreen?: FlowsInFullScreen;
}) {
  return (
    <Section id={specimen.id} title={specimen.title} description={specimen.description ?? ""} onAsk={onAsk}>
      {/* What the checks cover (see a11y.ts); display: contents keeps the layout as it was. */}
      <div {...{ [CHECKED]: specimen.title }} style={{ display: "contents" }}>
        <FullScreen.Provider value={fullScreen ?? null}>
          <SpecimenBlocks specimen={specimen} design={design} frames={frames} />
        </FullScreen.Provider>
      </div>
    </Section>
  );
}
