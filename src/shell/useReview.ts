import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlternativeColumn, CompareLayout, NavSection, PastVersion, ReviewView } from "../../shared/frame.ts";
import type { Baseline, ClientMessage } from "../../shared/protocol.ts";
import { ALTERNATIVE_LABELS, type ReviewState } from "../../shared/review.ts";
import type { BridgeState } from "../bridge.ts";
import { usePref } from "./prefs.ts";

/**
 * The chrome's side of the open review: fetching its starting point (and its alternatives), what the
 * preview should show, and the "also changed" list. The review comes into
 * view whenever the agent opens it or records a new iteration, since that is
 * when it has something to show; `onShown` runs then (the app stops inspecting
 * history).
 */
export function useReview(
  state: BridgeState,
  send: (message: ClientMessage) => void,
  sections: NavSection[],
  onShown: () => void,
) {
  const review = state.review;
  const [layout, setLayout] = usePref<CompareLayout>("review-layout", (stored) =>
    stored === "stacked" || stored === "blink" ? stored : "split",
  );
  /** True while the user looks at the gallery instead of the open review. */
  const [hidden, setHidden] = useState(false);
  /** Sections outside the review that changed, as the preview reports them, and the ones the user opened. */
  const [impact, setImpact] = useState<string[]>([]);
  const [peeks, setPeeks] = useState<string[]>([]);

  const baselineId = review?.baseline;
  const baseline = baselineId ? state.baselines[baselineId] : undefined;
  // Past versions the review needs: its starting point, and where alternatives started and ended.
  const alternatives = review?.alternatives;
  const needed = [
    baselineId,
    alternatives?.start,
    ...(alternatives?.options.map((option) => option.step) ?? []),
  ].filter((id): id is string => Boolean(id));
  const missing = needed.filter((id) => !state.baselines[id]).join(" ");
  /** Asked for and not answered yet; the answers arrive one at a time. */
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const ids = missing.split(" ").filter(Boolean);
    // Answered ones are done, so a version missing again (the copies were removed) is asked for again.
    for (const id of requested.current) if (!ids.includes(id)) requested.current.delete(id);
    for (const id of ids) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      send({ type: "baseline-get", id });
    }
  }, [missing, send]);

  const stepCount = review?.steps.length ?? 0;
  useEffect(() => {
    if (!baselineId) return;
    setHidden(false);
    onShown();
    // onShown is a notification, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineId, stepCount]);

  useEffect(() => {
    setImpact([]);
    setPeeks([]);
  }, [baselineId]);

  const view = useMemo<ReviewView | null>(
    () =>
      review && !hidden
        ? {
            title: review.title,
            targets: [...review.show, ...peeks.map((id) => ({ specimen: id, peek: true }))],
            layout,
            baseline: past(baseline),
            reach: review.reach,
            alternatives: review.alternatives ? alternativesView(review, state.baselines) : undefined,
          }
        : null,
    [review, hidden, peeks, layout, baseline, state.baselines],
  );

  // Opened sections stay listed: the preview stops checking what the review already shows.
  const listed = new Set([...impact, ...peeks]);
  const impactSections = sections.filter((section) => listed.has(section.id));

  const togglePeek = useCallback((id: string) => {
    setPeeks((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    setHidden(false);
  }, []);

  return { review, baseline, view, hidden, setHidden, layout, setLayout, impactSections, peeks, togglePeek, setImpact };
}

function past(baseline: Baseline | undefined): PastVersion | null {
  return baseline ? { design: baseline.design, base: baseline.base } : null;
}

/**
 * The columns of a set of alternatives. The workspace holds the one being made
 * (or, once all are made, the last one), so that one runs live: its problems
 * reach the agent's fix loop. The others run as the versions they ended at.
 */
function alternativesView(review: ReviewState, baselines: Record<string, Baseline>): ReviewView["alternatives"] {
  const set = review.alternatives!;
  const live = set.done ? set.options.length - 1 : set.options.length;
  const columns = ALTERNATIVE_LABELS.slice(0, set.count).map((label, index): AlternativeColumn => {
    const option = set.options[index];
    if (index === live) return { label, kind: "live" };
    if (option) return { label, kind: "past", version: past(baselines[option.step]) };
    return { label, kind: "pending" };
  });
  return { before: past(baselines[set.start]), columns, making: !set.done };
}
