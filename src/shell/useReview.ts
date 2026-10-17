import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompareLayout, NavSection, ReviewView } from "../../shared/frame.ts";
import type { ClientMessage } from "../../shared/protocol.ts";
import type { BridgeState } from "../bridge.ts";
import { usePref } from "./prefs.ts";

/**
 * The chrome's side of the open review: fetching its starting point, what the
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
    stored === "stacked" ? "stacked" : "split",
  );
  /** True while the user looks at the gallery instead of the open review. */
  const [hidden, setHidden] = useState(false);
  /** Sections outside the review that changed, as the preview reports them, and the ones the user opened. */
  const [impact, setImpact] = useState<string[]>([]);
  const [peeks, setPeeks] = useState<string[]>([]);

  const baselineId = review?.baseline;
  const baseline = baselineId ? state.baselines[baselineId] : undefined;
  useEffect(() => {
    if (baselineId && !baseline) send({ type: "baseline-get", id: baselineId });
  }, [baselineId, baseline, send]);

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
            baseline: baseline ? { design: baseline.design, base: baseline.base } : null,
            reach: review.reach,
          }
        : null,
    [review, hidden, peeks, layout, baseline],
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
