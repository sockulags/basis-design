import { useEffect, useState, type FormEvent } from "react";
import type { Design } from "../../shared/design.ts";
import type { ReviewView, ReviewViewTarget } from "../../shared/frame.ts";
import { describeTarget } from "../../shared/review.ts";
import { previewCss } from "../../shared/tokens.ts";
import { describe, onHotUpdate, setProblem } from "./errors.ts";
import styles from "./Review.module.css";
import { SectionBoundary } from "./SectionBoundary.tsx";
import {
  findSpecimen,
  loadPastSpecimen,
  loadRebasedSpecimen,
  narrowSpecimen,
  SpecimenBlocks,
  type LoadedSpecimen,
} from "./specimens.tsx";

interface ReviewProps {
  view: ReviewView;
  /** Every live specimen; targets are resolved against them. */
  specimens: LoadedSpecimen[];
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
}

/**
 * What a review shows: each target twice, as it was when the review started
 * (running that version's own code with its own tokens) and as it is now.
 * The "before" side is history, so its problems show in place but are never
 * reported to the agent; a target that does not resolve is reported, so the
 * agent can fix its review.json.
 */
export function Review({ view, specimens, design, theme, onAsk }: ReviewProps) {
  const baseline = view.baseline;
  return (
    <div className={styles.review} data-layout={view.layout}>
      {baseline && <style>{previewCss(baseline.design, '.ds-root[data-side="baseline"]')}</style>}
      {baseline?.design.typography.fontImports.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <header className={styles.header}>
        <p className={styles.kicker}>Review</p>
        <h1 className={styles.title}>{view.title}</h1>
      </header>
      {view.targets.map((target, index) => (
        <Target
          key={`${index}-${describeTarget(target)}`}
          index={index}
          target={target}
          specimens={specimens}
          baseline={baseline}
          design={design}
          theme={theme}
          onAsk={onAsk}
        />
      ))}
    </div>
  );
}

interface TargetProps {
  index: number;
  target: ReviewViewTarget;
  specimens: LoadedSpecimen[];
  baseline: ReviewView["baseline"];
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
}

function Target({ index, target, specimens, baseline, design, theme, onAsk }: TargetProps) {
  const live = findSpecimen(specimens, target.specimen);
  const narrowed = live ? narrowSpecimen(live, target) : null;
  const problem = !live
    ? `there is no specimen titled "${target.specimen}". Specimens: ${specimens.map((item) => `"${item.title}"`).join(", ")}.`
    : narrowed && "problem" in narrowed
      ? narrowed.problem
      : null;
  const before = useBefore(baseline?.base, live, target);
  // Peeks name their section by id, and blocks without a title go by number; show names people read.
  const label = describeTarget({
    ...target,
    specimen: live?.title ?? target.specimen,
    block: target.block && !/^\d+$/.test(target.block) ? target.block : undefined,
  });

  // Only what the agent asked to show is its to fix; a section the user peeks at is not.
  const key = `Review target ${index + 1}`;
  useEffect(() => {
    if (target.peek) return;
    setProblem(key, problem ? `review.json show[${index}]: ${problem}` : null);
    return () => setProblem(key, null);
  }, [key, problem, index, target.peek]);

  return (
    <section id={live?.id} className={styles.target}>
      <header className={styles.targetHeader}>
        <h2 className={styles.targetTitle}>
          {label}
          {target.peek && <span className={styles.peek}>Also changed</span>}
        </h2>
        {live && (
          <button type="button" className="ask-button" onClick={() => onAsk(`${label}: `)}>
            Refine with agent
          </button>
        )}
      </header>
      {problem || !narrowed || "problem" in narrowed ? (
        <div className="section-error" role="alert">
          <strong>This part of the review cannot be shown</strong>
          <code>{problem}</code>
        </div>
      ) : (
        <div className={styles.panes}>
          {/* A form of its own, so radio groups here and on the live side are separate groups. */}
          <form className={`ds-root ${styles.pane}`} data-side="baseline" data-theme={theme} onSubmit={preventSubmit}>
            <p className={styles.paneLabel}>
              Before
              {before.state === "ready" && before.rebased && (
                <span className={styles.paneNote}>today's demo on the starting point's components</span>
              )}
            </p>
            {!baseline || before.state === "loading" ? (
              <p className={styles.notice}>Preparing the starting point…</p>
            ) : before.state === "failed" ? (
              <div className="section-error" role="alert">
                <strong>The starting point could not be loaded</strong>
                <code>{before.message}</code>
              </div>
            ) : before.state === "none" ? (
              <p className={styles.notice}>New in this review: it did not exist at the starting point.</p>
            ) : (
              <SectionBoundary name={`${label} (before)`} onAsk={onAsk} report={false}>
                <SpecimenBlocks specimen={before.specimen} design={baseline.design} />
              </SectionBoundary>
            )}
          </form>
          <div className={`ds-root ${styles.pane}`} data-side="now" data-theme={theme}>
            <p className={styles.paneLabel}>Now</p>
            <SectionBoundary name={label} onAsk={onAsk}>
              <SpecimenBlocks specimen={narrowed.specimen} design={design} />
            </SectionBoundary>
          </div>
        </div>
      )}
    </section>
  );
}

const preventSubmit = (event: FormEvent) => event.preventDefault();

type Before =
  | { state: "loading" }
  | { state: "none" }
  | { state: "failed"; message: string }
  | { state: "ready"; specimen: LoadedSpecimen; rebased: boolean };

/** Counts hot updates, so what depends on today's source can load it again. */
function useHotVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onHotUpdate(() => setVersion((value) => value + 1)), []);
  return version;
}

/**
 * What the "before" side shows: the target at the review's starting point.
 * When the starting point lacks it (the agent added a block to show a state),
 * today's specimen runs on the starting point's components and tokens instead,
 * so a new demo still compares old against new.
 */
function useBefore(base: string | undefined, live: LoadedSpecimen | undefined, target: ReviewViewTarget): Before {
  const [before, setBefore] = useState<Before>({ state: "loading" });
  const version = useHotVersion();
  const key = base && live ? `${base}|${live.file}|${live.id}|${JSON.stringify(target)}|${version}` : "";

  useEffect(() => {
    if (!base || !live) return;
    let current = true;
    const narrowed = (specimen: LoadedSpecimen | null) => {
      const result = specimen ? narrowSpecimen(specimen, target) : null;
      return result && "specimen" in result ? result.specimen : null;
    };
    void (async () => {
      const past = narrowed(await loadPastSpecimen(base, live));
      if (past) return { state: "ready", specimen: past, rebased: false } as const;
      const rebased = narrowed(await loadRebasedSpecimen(base, live, version));
      return rebased ? ({ state: "ready", specimen: rebased, rebased: true } as const) : ({ state: "none" } as const);
    })().then(
      (next) => current && setBefore(next),
      (error: unknown) => current && setBefore({ state: "failed", message: describe(error) }),
    );
    return () => {
      current = false;
    };
    // key captures everything the effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return before;
}
