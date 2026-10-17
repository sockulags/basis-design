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
}

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

export interface ReviewState extends ReviewRequest {
  /** The commit the review started from; the "before" side. */
  baseline: string;
  startedAt: number;
  steps: ReviewStep[];
  /** Source files that differ from the baseline in the latest step. */
  files: string[];
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
export function parseReviewRequest(text: string): { ok: true; request: ReviewRequest } | { ok: false; errors: string[] } {
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
      show.push({
        specimen: specimen.slice(0, 80),
        block: typeof target.block === "string" ? target.block.trim().slice(0, 80) : undefined,
        rows: labels(target.rows, `${field}.rows`, errors),
        columns: labels(target.columns, `${field}.columns`, errors),
      });
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, request: { title, show } };
}

/** "Buttons › Variants · primary, danger", for labels in the UI and the agent's context. */
export function describeTarget(target: ReviewTarget): string {
  const parts = [target.specimen, target.block].filter(Boolean).join(" › ");
  const narrowed = [...(target.rows ?? []), ...(target.columns ?? [])];
  return narrowed.length ? `${parts} · ${narrowed.join(", ")}` : parts;
}
