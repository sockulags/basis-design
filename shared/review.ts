/**
 * Reviews: the agent opens one by writing review.json in the workspace when it
 * has something specific to show. While a review is open every change belongs
 * to it; the user iterates with the agent and finally approves (one history
 * entry) or discards it (back to where it started).
 */

/** The file the agent writes to open or update a review. */
export const REVIEW_FILE = "review.json";

const MAX_TARGETS = 4;
const MAX_LABELS = 20;

/** One thing the review shows: a specimen, optionally narrowed to a block and some of its rows and columns. */
export interface ReviewTarget {
  /** Title or id of the specimen. */
  specimen: string;
  /** Title of one block in that specimen; all blocks when omitted. */
  block?: string;
  /** Matrix row labels or grid item labels to keep. */
  rows?: string[];
  /** Matrix column labels to keep. */
  columns?: string[];
  /** Widths to show each block at, as size containers: "fit" (the column), "mobile", "tablet", "desktop". */
  widths?: ReviewWidth[];
}

export const REVIEW_WIDTHS = ["fit", "mobile", "tablet", "desktop"] as const;
export type ReviewWidth = (typeof REVIEW_WIDTHS)[number];

export interface ReviewRequest {
  title: string;
  show: ReviewTarget[];
}

/** One iteration: the state after an agent turn or an edit while the review was open. */
export interface ReviewStep {
  id: string;
  at: number;
  label: string;
}

/** How many alternatives one prompt can ask for, and what they are called. */
export const ALTERNATIVE_LABELS = ["A", "B", "C"] as const;
export const MAX_ALTERNATIVES = ALTERNATIVE_LABELS.length;

/**
 * A set of alternatives: the agent made several takes on one prompt, each from
 * the same starting point, and the user picks one to continue with. Each take
 * is an iteration of the review; the workspace holds the last one.
 */
export interface Alternatives {
  prompt: string;
  /** The commit every alternative started from. */
  start: string;
  /** How many were asked for (how many were made, once done). */
  count: number;
  /** The finished ones, in order: each one's label and the iteration it ended at. */
  options: { label: string; step: string }[];
  /** False while the agent is still making them. */
  done: boolean;
}

export interface ReviewState extends ReviewRequest {
  /** The commit the review started from; the "before" side. */
  baseline: string;
  startedAt: number;
  steps: ReviewStep[];
  /** Source files that differ from the baseline in the latest step. */
  files: string[];
  /**
   * The specimen files the review's changes can reach (`components/Badge.specimen.tsx`), which bounds the
   * "also changed" check; null when they can reach everything, absent until the first iteration.
   */
  reach?: string[] | null;
  /** Alternatives being made, or waiting for the user to pick one. */
  alternatives?: Alternatives;
}

function labels(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${field} must be an array of labels`);
    return undefined;
  }
  return value.slice(0, MAX_LABELS).map((item: string) => item.trim().slice(0, 80));
}

/** Validates review.json; every problem is phrased so the agent can fix it. */
export function parseReviewRequest(
  text: string,
): { ok: true; request: ReviewRequest } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`review.json is not valid JSON: ${(error as Error).message}`] };
  }
  const errors: string[] = [];
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim().slice(0, 120) : "";
  if (!title) errors.push('review.json needs a "title": what is being improved, in a few words');
  const show: ReviewTarget[] = [];
  if (!Array.isArray(data.show) || data.show.length === 0) {
    errors.push('review.json needs a "show" array with at least one { "specimen": "..." }');
  } else {
    data.show.slice(0, MAX_TARGETS).forEach((item: unknown, index) => {
      const target = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const field = `show[${index}]`;
      const specimen = typeof target.specimen === "string" ? target.specimen.trim() : "";
      if (!specimen) {
        errors.push(`${field}.specimen must be the title of a specimen`);
        return;
      }
      if (target.block !== undefined && (typeof target.block !== "string" || !target.block.trim())) {
        errors.push(`${field}.block must be the title of one of the specimen's blocks`);
        return;
      }
      let widths: ReviewWidth[] | undefined;
      if (target.widths !== undefined) {
        const valid = Array.isArray(target.widths) && target.widths.every((width) => REVIEW_WIDTHS.includes(width));
        if (valid && (target.widths as unknown[]).length) widths = target.widths as ReviewWidth[];
        else errors.push(`${field}.widths must be a list of ${REVIEW_WIDTHS.map((width) => `"${width}"`).join(", ")}`);
      }
      show.push({
        specimen: specimen.slice(0, 80),
        block: typeof target.block === "string" ? target.block.trim().slice(0, 80) : undefined,
        rows: labels(target.rows, `${field}.rows`, errors),
        columns: labels(target.columns, `${field}.columns`, errors),
        ...(widths ? { widths } : {}),
      });
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, request: { title, show } };
}

/** "Buttons › Variants · primary, danger", for labels in the UI and the agent's context. */
export function describeTarget(target: ReviewTarget): string {
  const parts = [target.specimen, target.block].filter(Boolean).join(" › ");
  const narrowed = [...(target.rows ?? []), ...(target.columns ?? [])];
  // Fit alone is the usual view and needs no mention.
  const shown = target.widths?.some((width) => width !== "fit") ? target.widths : [];
  const label = narrowed.length ? `${parts} · ${narrowed.join(", ")}` : parts;
  return shown.length ? `${label} (${shown.join(", ")})` : label;
}
