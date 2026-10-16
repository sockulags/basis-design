import type { Annotation } from "./annotations.ts";
import type { Design } from "./design.ts";

/**
 * postMessage protocol between the chrome and the sandboxed preview iframe.
 * The preview runs agent-written code, so the chrome treats everything it
 * receives as untrusted data: it validates shapes and never lets a message
 * trigger a prompt, a permission answer or any other privileged action.
 */

/** A component section the preview found in the workspace's specimen files. */
export interface NavSection {
  id: string;
  title: string;
  group: string;
}

export type ToPreview =
  | { type: "render"; design: Design; theme: "light" | "dark" }
  | { type: "scroll-to"; id: string }
  | { type: "picking"; on: boolean }
  | { type: "picks-remove"; index: number }
  | { type: "picks-clear" };

export type FromPreview =
  | { type: "ready" }
  | { type: "active-section"; id: string }
  | { type: "ask"; prefix: string }
  | { type: "picks"; annotations: Annotation[] }
  | { type: "picking"; on: boolean }
  | { type: "errors"; errors: string[] }
  | { type: "sections"; sections: NavSection[] };

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" ? value.slice(0, max) : null;

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

/** Narrows an untrusted message from the preview to a known, size-limited shape, or null. */
export function parseFromPreview(data: unknown): FromPreview | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  switch (raw.type) {
    case "ready":
      return { type: "ready" };
    case "active-section": {
      const id = text(raw.id, 80);
      return id ? { type: "active-section", id } : null;
    }
    case "ask": {
      const prefix = text(raw.prefix, 200);
      return prefix ? { type: "ask", prefix } : null;
    }
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
    case "sections":
      return Array.isArray(raw.sections)
        ? {
            type: "sections",
            sections: raw.sections.slice(0, 80).flatMap((item: unknown) => {
              const section = item as Record<string, unknown> | null;
              const id = text(section?.id, 80);
              const title = text(section?.title, 80);
              const group = text(section?.group, 40);
              return id && /^[a-z0-9-]+$/.test(id) && title && group ? [{ id, title, group }] : [];
            }),
          }
        : null;
    default:
      return null;
  }
}
