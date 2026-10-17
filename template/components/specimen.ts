import type { ComponentType } from "react";

/**
 * Specimens describe how the Basis gallery shows components. Every
 * `*.specimen.tsx` file in this folder default-exports one specimen (or an
 * array of them) and becomes a section in the gallery and its sidebar.
 *
 * Every `render` is used as a React component, so it may use hooks for live
 * demos (a toggle, a replay button).
 */

/** The tokens from design-system.json, for specimens that depend on them (for example the tabs variant). */
export type DesignTokens = {
  components: Record<string, Record<string, string>>;
} & Record<string, unknown>;

export interface RenderProps {
  design: DesignTokens;
}

export interface CellProps extends RenderProps {
  /** Row label, as given in `rows`. */
  row: string;
  /** Column label, as given in `columns`. */
  column: string;
}

export type SpecimenBlock =
  /** A grid of rows × columns, typically variants × states. */
  | {
      kind: "matrix";
      title?: string;
      rows: string[];
      columns: string[];
      minColumn?: number;
      render: ComponentType<CellProps>;
    }
  /** Labelled examples in a responsive grid. */
  | { kind: "grid"; title?: string; min?: number; items: { label: string; render: ComponentType<RenderProps> }[] }
  /** Free content laid out in a wrapping row. */
  | { kind: "row"; title?: string; render: ComponentType<RenderProps> }
  /** Free content, full width. */
  | { kind: "block"; title?: string; render: ComponentType<RenderProps> };

export interface Specimen {
  /** Anchor and sidebar id; defaults to the title in kebab-case. */
  id?: string;
  title: string;
  description?: string;
  /** Sidebar group; defaults to "Components". */
  group?: string;
  /** Position within the group, lowest first. */
  order?: number;
  blocks: SpecimenBlock[];
}

/** Identity helper that gives specimen files type checking. */
export function defineSpecimen<T extends Specimen | Specimen[]>(specimen: T): T {
  return specimen;
}

/** Maps a state column label ("hover", "focus-visible", "pressed" ...) to a component's `force` prop. */
export function forced(state: string): "hover" | "focus" | "active" | undefined {
  if (state === "hover") return "hover";
  if (state === "focus" || state === "focus-visible") return "focus";
  if (state === "active" || state === "pressed") return "active";
  return undefined;
}
