import type { Annotation } from "./annotations.ts";
import type { Design } from "./design.ts";
import type { ReviewTarget } from "./review.ts";
import { parseWidths, type Widths } from "./widths.ts";

/**
 * postMessage protocol between the chrome and the sandboxed preview iframe.
 * The preview runs agent-written code, so the chrome treats everything it
 * receives as untrusted data: it validates shapes and never lets a message
 * trigger a prompt, a permission answer or any other privileged action.
 */

/**
 * Pages of the gallery: the design system itself, and patterns composed from it.
 * Each page shows the specimens of one agent-owned source folder in the
 * workspace, and `kind` names what that folder holds. A new page is a new entry
 * here plus its starter folder in template/.
 */
export const PAGES = [
  { id: "system", label: "Design system", folder: "components", kind: "component" },
  { id: "patterns", label: "Patterns", folder: "patterns", kind: "pattern" },
  { id: "views", label: "Views", folder: "views", kind: "view" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];
export type SourceFolder = (typeof PAGES)[number]["folder"];

/** Workspace folders of agent-owned source, in page order. */
export const SOURCE_FOLDERS: SourceFolder[] = PAGES.map((page) => page.folder);

export function pageById(id: PageId): (typeof PAGES)[number] {
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

/** A name for a new component or pattern: PascalCase, usable as an export and a file name. */
export function isComponentName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]{0,47}$/.test(value);
}

/** "date picker" and "date-picker" both become "DatePicker". */
export function toComponentName(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
}

export function isPageId(value: unknown): value is PageId {
  return PAGES.some((page) => page.id === value);
}

/** A section the preview found in the workspace's specimen files. */
export interface NavSection {
  id: string;
  title: string;
  group: string;
  page: PageId;
}

/** How a review shows before and after: next to each other, one above the other, or in the same place. */
export type CompareLayout = "split" | "stacked" | "blink";

/** A review target as the preview shows it; peeks are sections the user opened from "Also changed". */
export type ReviewViewTarget = ReviewTarget & { peek?: boolean };

/** A past version the preview can run: its tokens, and where it imports that version's source from. */
export interface PastVersion {
  design: Design;
  base: string;
}

/**
 * One alternative as the preview shows it: a past version (null while it is
 * being prepared), the workspace as it is now, or one still to be made.
 */
export type AlternativeColumn = { label: string } & (
  { kind: "past"; version: PastVersion | null } | { kind: "live" } | { kind: "pending" }
);

/** The review view: what the review shows, before (the review's starting point) next to now. */
export interface ReviewView {
  title: string;
  targets: ReviewViewTarget[];
  layout: CompareLayout;
  /** The starting point, or null while it is being prepared. */
  baseline: PastVersion | null;
  /** Specimen files the changes can reach; "also changed" checks only these (all, when absent or null). */
  reach?: string[] | null;
  /** With alternatives, each target shows where they started next to every alternative instead. */
  alternatives?: { before: PastVersion | null; columns: AlternativeColumn[]; making: boolean };
}

/**
 * A view shown alone, filling the screen: the specimen, and the screen and theme it opened on. Where it goes from
 * there is the preview's to keep (see src/preview/FullScreen.tsx), so moving through it sends nothing.
 */
export interface FullScreenView {
  view: string;
  screen: string;
  theme: "light" | "dark";
}

/**
 * Everything the preview renders, sent as one value whenever any of it
 * changes. A new preview feature adds a field here rather than a prop at
 * every layer between the chrome and the gallery.
 */
export interface PreviewView {
  design: Design;
  theme: "light" | "dark";
  page: PageId;
  review: ReviewView | null;
  /** A view in full screen over everything else, or null. */
  fullscreen: FullScreenView | null;
  /** The project's widths, which Show at's frames and the layout check use. */
  widths: Widths;
}

export type ToPreview =
  | { type: "render"; view: PreviewView }
  | { type: "scroll-to"; id: string }
  | { type: "picking"; on: boolean }
  | { type: "picks-remove"; index: number }
  | { type: "picks-clear" }
  /** The B key pressed or let go in the chrome while a review blinks, so it works wherever focus is. */
  | { type: "blink-key"; down: boolean };

export type FromPreview =
  /** A fresh preview document; `generation` is the one the preview server served it in (see shared/hold.ts). */
  | { type: "ready"; generation: number }
  | { type: "active-section"; id: string }
  | { type: "ask"; prefix: string }
  /** Sections outside the review's targets that look different from the review's starting point. */
  | { type: "impact"; ids: string[] }
  | { type: "picks"; annotations: Annotation[] }
  | { type: "picking"; on: boolean }
  | { type: "errors"; errors: string[] }
  /** Findings of the automatic checks (contrast, accessibility, layout), and whether one is still running. */
  | { type: "checks"; checks: string[]; running: boolean }
  | { type: "sections"; sections: NavSection[] }
  /** Full screen asked for from a view's screen strip; the chrome takes it only right after a click. */
  | ({ type: "fullscreen-open" } & FullScreenView)
  /** The full-screen bar's Exit, or Esc where the browser leaves it to the page. */
  | { type: "fullscreen-exit" }
  /** New widths for the project from the control next to Show at (null: Basis' defaults); taken only after a click. */
  | { type: "widths-set"; widths: Widths | null };

const text = (value: unknown, max: number): string | null => (typeof value === "string" ? value.slice(0, max) : null);

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    const clean = text(item, 400);
    if (clean !== null) out[key.slice(0, 80)] = clean;
  }
  return out;
}

function annotation(value: unknown): Annotation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const component = text(raw.component, 60);
  if (!component) return null;
  return {
    component,
    section: text(raw.section, 120) ?? undefined,
    variant: text(raw.variant, 60) ?? undefined,
    state: text(raw.state, 60) ?? undefined,
    theme: raw.theme === "dark" ? "dark" : "light",
    tokenPath: text(raw.tokenPath, 120) ?? undefined,
    tokens: record(raw.tokens),
    styles: record(raw.styles),
  };
}

function fullScreenView(raw: Record<string, unknown>): FullScreenView | null {
  const view = text(raw.view, 80);
  const screen = text(raw.screen, 80);
  if (!view || !/^[a-z0-9-]+$/.test(view) || !screen) return null;
  return { view, screen, theme: raw.theme === "dark" ? "dark" : "light" };
}

/** Narrows an untrusted message from the preview to a known, size-limited shape, or null. */
export function parseFromPreview(data: unknown): FromPreview | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  switch (raw.type) {
    case "ready": {
      const generation = Number.isSafeInteger(raw.generation) ? Math.max(0, raw.generation as number) : 0;
      return { type: "ready", generation };
    }
    case "active-section": {
      const id = text(raw.id, 80);
      return id ? { type: "active-section", id } : null;
    }
    case "ask": {
      const prefix = text(raw.prefix, 200);
      return prefix ? { type: "ask", prefix } : null;
    }
    case "impact":
      return Array.isArray(raw.ids)
        ? {
            type: "impact",
            ids: raw.ids
              .slice(0, 80)
              .map((id) => text(id, 80))
              .filter((id): id is string => id !== null && /^[a-z0-9-]+$/.test(id)),
          }
        : null;
    case "picks":
      return Array.isArray(raw.annotations)
        ? {
            type: "picks",
            annotations: raw.annotations
              .slice(0, 20)
              .map(annotation)
              .filter((item): item is Annotation => item !== null),
          }
        : null;
    case "picking":
      return { type: "picking", on: raw.on === true };
    case "errors":
      return Array.isArray(raw.errors)
        ? {
            type: "errors",
            errors: raw.errors
              .slice(0, 10)
              .map((error) => text(error, 600))
              .filter((error): error is string => error !== null),
          }
        : null;
    case "checks":
      return Array.isArray(raw.checks)
        ? {
            type: "checks",
            checks: raw.checks
              .slice(0, 60)
              .map((check) => text(check, 400))
              .filter((check): check is string => check !== null),
            running: raw.running === true,
          }
        : null;
    case "sections":
      return Array.isArray(raw.sections)
        ? {
            type: "sections",
            sections: raw.sections.slice(0, 80).flatMap((item: unknown) => {
              const section = item as Record<string, unknown> | null;
              const id = text(section?.id, 80);
              const title = text(section?.title, 80);
              const group = text(section?.group, 40);
              const page = section?.page;
              return id && /^[a-z0-9-]+$/.test(id) && title && group && isPageId(page)
                ? [{ id, title, group, page }]
                : [];
            }),
          }
        : null;
    case "fullscreen-open": {
      const place = fullScreenView(raw);
      return place ? { type: "fullscreen-open", ...place } : null;
    }
    case "fullscreen-exit":
      return { type: "fullscreen-exit" };
    case "widths-set": {
      if (raw.widths === null) return { type: "widths-set", widths: null };
      const widths = parseWidths(raw.widths);
      return widths ? { type: "widths-set", widths } : null;
    }
    default:
      return null;
  }
}
