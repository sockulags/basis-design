import { useEffect, useMemo, useState } from "react";
import type { Design } from "../../shared/design.ts";
import { diffDesigns } from "../../shared/diff.ts";
import type { CompareLayout, NavSection } from "../../shared/frame.ts";
import type { ReviewState } from "../../shared/review.ts";
import { when } from "./history.ts";
import { Value } from "./InspectBanner.tsx";
import styles from "./Shell.module.css";

interface ReviewBarProps {
  review: ReviewState;
  /** Tokens at the review's starting point, once loaded. */
  baselineDesign: Design | undefined;
  current: Design;
  busy: boolean;
  problems: number;
  /** Sections outside the review that look different from the starting point. */
  impact: NavSection[];
  peeks: string[];
  onTogglePeek: (id: string) => void;
  layout: CompareLayout;
  onLayout: (layout: CompareLayout) => void;
  /** Whether the preview shows the review (true) or the gallery. */
  showing: boolean;
  onShowing: (showing: boolean) => void;
  onStep: (id: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
}

const LIST_LIMIT = 60;
const CONFIRM_MS = 3000;

/** The open review: what it is about, its iterations and changes, and the way out (approve or discard). */
export function ReviewBar(props: ReviewBarProps) {
  const { review, baselineDesign, current, busy, problems, impact, peeks, layout, showing } = props;
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const changes = useMemo(() => (baselineDesign ? diffDesigns(baselineDesign, current) : []), [baselineDesign, current]);
  const steps = review.steps;
  const latest = steps.at(-1);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const blocked = busy
    ? "Wait until the agent is done"
    : problems > 0
      ? `Fix the ${problems === 1 ? "problem" : `${problems} problems`} first`
      : steps.length === 0
        ? "Nothing has changed yet"
        : null;
  const summary = [
    changes.length ? `${changes.length} ${changes.length === 1 ? "token" : "tokens"}` : "",
    review.files.length ? `${review.files.length} ${review.files.length === 1 ? "file" : "files"}` : "",
  ].filter(Boolean);

  return (
    <div className={styles.inspect} data-review>
      <div className={styles.inspectRow}>
        <div className={styles.inspectText}>
          <strong>Reviewing “{review.title}”</strong>
          <span className={styles.muted}>
            {busy
              ? "The agent is working on it…"
              : steps.length === 0
                ? `Started ${when(review.startedAt)}`
                : `Iteration ${steps.length} · ${when(latest!.at)}. Keep asking in the chat, then approve.`}
          </span>
        </div>
        {steps.length > 1 && (
          <label className={styles.versionSelect}>
            <span className="visually-hidden">Iteration</span>
            <select value={latest?.id} onChange={(event) => props.onStep(event.target.value)} disabled={busy}>
              {steps
                .map((step, index) => (
                  <option key={step.id} value={step.id}>
                    {index === steps.length - 1 ? "Latest" : `Back to ${index + 1}`} · {step.label.slice(0, 50)}
                  </option>
                ))
                .reverse()}
            </select>
          </label>
        )}
        <button
          type="button"
          className={styles.inspectToggle}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          disabled={summary.length === 0}
        >
          {summary.length ? `${summary.join(" · ")} changed` : "No changes yet"}
        </button>
        <div className={styles.themeToggle} role="group" aria-label="Preview">
          <button type="button" aria-pressed={showing} onClick={() => props.onShowing(true)}>
            Review
          </button>
          <button type="button" aria-pressed={!showing} onClick={() => props.onShowing(false)}>
            Gallery
          </button>
        </div>
        {showing && (
          <div className={styles.themeToggle} role="group" aria-label="Review layout">
            {(["split", "stacked"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={layout === value} onClick={() => props.onLayout(value)}>
                {value === "split" ? "Side by side" : "Stacked"}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.chromeButton}
          data-confirming={confirming || undefined}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            props.onDiscard();
          }}
          title="Put everything back as it was when the review started"
        >
          {confirming ? "Discard all changes?" : "Discard"}
        </button>
        <button type="button" className={styles.primaryButton} onClick={props.onApprove} disabled={blocked !== null} title={blocked ?? "Save this as one version in history"}>
          Approve
        </button>
      </div>
      {impact.length > 0 && (
        <div className={styles.reviewImpact}>
          <span className={styles.muted}>Also changed:</span>
          {impact.map((section) => (
            <button
              key={section.id}
              type="button"
              className={styles.reviewChip}
              aria-pressed={peeks.includes(section.id)}
              onClick={() => props.onTogglePeek(section.id)}
              title={peeks.includes(section.id) ? "Hide from the review" : "Show in the review"}
            >
              {section.title}
            </button>
          ))}
        </div>
      )}
      {expanded && (
        <div className={styles.diff}>
          {changes.length > 0 && (
            <>
              <span className={styles.diffHead}>Token</span>
              <span className={styles.diffHead}>Before</span>
              <span className={styles.diffHead}>Now</span>
              {changes.slice(0, LIST_LIMIT).map((change) => (
                <div key={change.path} className={styles.diffRow}>
                  <span className={styles.diffPath}>{change.path}</span>
                  <Value path={change.path} value={change.before} />
                  <Value path={change.path} value={change.after} />
                </div>
              ))}
              {changes.length > LIST_LIMIT && <span className={styles.muted}>and {changes.length - LIST_LIMIT} more</span>}
            </>
          )}
          {review.files.length > 0 && (
            <>
              <span className={styles.diffHead}>File</span>
              <span className={styles.diffHead} />
              <span className={styles.diffHead} />
              {review.files.map((file) => (
                <div key={file} className={styles.diffRow}>
                  <span className={styles.diffPath}>{file}</span>
                  <span />
                  <span />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
