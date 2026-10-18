import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import type { Design } from "../../shared/design.ts";
import type { PastVersion, ReviewView, ReviewViewTarget } from "../../shared/frame.ts";
import { describeTarget } from "../../shared/review.ts";
import { previewCss } from "../../shared/tokens.ts";
import { describe, onHotUpdate, setProblem } from "./errors.ts";
import styles from "./Review.module.css";
import { SectionBoundary } from "./SectionBoundary.tsx";
import { CHECKED } from "./a11y.ts";
import { findSpecimen, narrowSpecimen } from "./narrow.ts";
import {
  FlowSync,
  loadPastSpecimen,
  loadRebasedSpecimen,
  SpecimenBlocks,
  type FlowPosition,
  type Frames,
  type LoadedSpecimen,
} from "./specimens.tsx";

interface ReviewProps {
  view: ReviewView;
  /** Every live specimen; targets are resolved against them. */
  specimens: LoadedSpecimen[];
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
  /** In the copy in the other theme: the live side is also shown at phone width, for the layout check. */
  alsoPhone?: boolean;
}

/**
 * One version a review shows each target in. `key` is the pane's data-side,
 * which scopes a past version's tokens to its panes.
 */
interface Side {
  key: string;
  label: string;
  source:
    | {
        kind: "past";
        version: PastVersion | null;
        /** What the pane says when the target did not exist in that version. */
        missing: string;
        /** What the pane says when it runs today's demo on that version's components. */
        rebased: string;
      }
    | { kind: "live"; note?: string }
    | { kind: "pending" };
}

/** Before and now; or, with alternatives, where they started next to each alternative. */
function sidesOf(view: ReviewView): Side[] {
  const alternatives = view.alternatives;
  if (!alternatives) {
    return [
      {
        key: "baseline",
        label: "Before",
        source: {
          kind: "past",
          version: view.baseline,
          missing: "New in this review: it did not exist at the starting point.",
          rebased: "today's demo on the starting point's components",
        },
      },
      { key: "now", label: "Now", source: { kind: "live" } },
    ];
  }
  return [
    {
      key: "baseline",
      label: "Before",
      source: {
        kind: "past",
        version: alternatives.before,
        missing: "It did not exist where the alternatives started.",
        rebased: "today's demo on the starting point's components",
      },
    },
    ...alternatives.columns.map((column, index): Side => ({
      key: column.kind === "live" ? "now" : `alternative-${index}`,
      label: `Alternative ${column.label}`,
      source:
        column.kind === "past"
          ? {
              kind: "past",
              version: column.version,
              missing: "This alternative does not have it.",
              rebased: "today's demo on this alternative's components",
            }
          : column.kind === "live"
            ? { kind: "live", note: alternatives.making ? "being made" : undefined }
            : { kind: "pending" },
    })),
  ];
}

/**
 * What a review shows: each target as it was when the review started (running
 * that version's own code with its own tokens) next to how it is now; or, for
 * a set of alternatives, where they started next to each one. Past versions
 * are history, so their problems show in place but are never reported to the
 * agent; a target that does not resolve is reported, so the agent can fix its
 * review.json.
 */
export function Review({ view, specimens, design, theme, onAsk, alsoPhone = false }: ReviewProps) {
  const sides = sidesOf(view);
  const blink = useBlink(view.layout === "blink", sides.length);
  const pasts = sides.flatMap((side) =>
    side.source.kind === "past" && side.source.version ? [{ key: side.key, version: side.source.version }] : [],
  );
  const fonts = [...new Set(pasts.flatMap((past) => past.version.design.typography.fontImports))];
  return (
    <div className={styles.review} data-layout={view.layout}>
      {pasts.map((past) => (
        <style key={past.key}>{previewCss(past.version.design, `.ds-root[data-side="${past.key}"]`)}</style>
      ))}
      {fonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <header className={styles.header}>
        <p className={styles.kicker}>{view.alternatives ? "Review · alternatives" : "Review"}</p>
        <h1 className={styles.title}>{view.title}</h1>
        {view.alternatives && (
          <p className={styles.lead}>
            {view.alternatives.making
              ? "The agent is making the alternatives one at a time, each from the same starting point."
              : "Pick the one to continue with in the bar above; the others stay in the review's iterations."}
          </p>
        )}
        {view.layout === "blink" && (
          <div className={styles.blinkBar}>
            <span className={styles.blinkShowing}>{sides[blink.showing]?.label}</span>
            <span className={styles.blinkHint}>
              Click a pane or tap B to {sides.length > 2 ? "go to the next" : "switch"}; hold B to see before.
            </span>
            <button type="button" className="ask-button" aria-pressed={blink.auto} onClick={blink.toggleAuto}>
              {blink.auto ? "Stop" : "Auto"}
            </button>
          </div>
        )}
      </header>
      {view.targets.map((target, index) => (
        <Target
          key={`${index}-${describeTarget(target)}`}
          index={index}
          target={target}
          specimens={specimens}
          sides={sides}
          design={design}
          theme={theme}
          onAsk={onAsk}
          showing={view.layout === "blink" ? blink.showing : null}
          onFlip={blink.flip}
          alsoPhone={alsoPhone}
        />
      ))}
    </div>
  );
}

/** How long B must be held to count as holding rather than a tap. */
const HOLD_MS = 250;

/**
 * Which side blink mode shows (an index into the sides; the last one until the
 * user switches), and the ways to switch: a click, the B key, or automatically.
 */
function useBlink(active: boolean, count: number) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const [auto, setAuto] = useState(false);
  const next = () => setChosen((value) => ((value ?? count - 1) + 1) % count);

  useEffect(() => {
    if (!active) return;
    // A tap switches sides; holding the key shows before until it is let go.
    let pressedAt = 0;
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.repeat ||
        pressedAt ||
        (event.target as Element).closest?.("input, textarea, select, [contenteditable]")
      )
        return;
      pressedAt = performance.now();
      setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !pressedAt) return;
      if (performance.now() - pressedAt < HOLD_MS) setChosen((value) => ((value ?? count - 1) + 1) % count);
      pressedAt = 0;
      setHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [active, count]);

  useEffect(() => {
    if (!active || !auto) return;
    const timer = setInterval(() => setChosen((value) => ((value ?? count - 1) + 1) % count), 500);
    return () => clearInterval(timer);
  }, [active, auto, count]);

  const showing = held ? 0 : Math.min(chosen ?? count - 1, count - 1);
  return { showing, auto, flip: next, toggleAuto: () => setAuto((value) => !value) };
}

interface TargetProps {
  index: number;
  target: ReviewViewTarget;
  specimens: LoadedSpecimen[];
  sides: Side[];
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
  /** In blink mode, the side on show (an index into `sides`); null shows them all. */
  showing: number | null;
  onFlip: () => void;
  alsoPhone: boolean;
}

function Target({ index, target, specimens, sides, design, theme, onAsk, showing, onFlip, alsoPhone }: TargetProps) {
  const live = findSpecimen(specimens, target.specimen);
  const narrowed = live ? narrowSpecimen(live, target) : null;
  const problem = !live
    ? `there is no specimen titled "${target.specimen}". Specimens: ${specimens.map((item) => `"${item.title}"`).join(", ")}.`
    : narrowed && "problem" in narrowed
      ? narrowed.problem
      : null;
  // Peeks name their section by id, and blocks without a title go by number; show names people read.
  const label = describeTarget({
    ...target,
    specimen: live?.title ?? target.specimen,
    block: target.block && !/^\d+$/.test(target.block) ? target.block : undefined,
  });

  // A view's panes move through its flow together, so every side shows the same screen.
  const [position, setPosition] = useState<FlowPosition | null>(null);
  const flowSync = useMemo(() => ({ position, move: setPosition }), [position]);

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
      {problem || !live || !narrowed || "problem" in narrowed ? (
        <div className="section-error" role="alert">
          <strong>This part of the review cannot be shown</strong>
          <code>{problem}</code>
        </div>
      ) : (
        <FlowSync.Provider value={flowSync}>
          <div
            className={styles.panes}
            style={{ "--sides": sides.length } as CSSProperties}
            onClick={showing === null ? undefined : (event) => flipUnlessControl(event, onFlip)}
          >
            {sides.map((side, position) => {
              const hidden = showing !== null && showing !== position;
              const source = side.source;
              if (source.kind === "live") {
                return (
                  <div
                    key={side.key}
                    className={`ds-root ${styles.pane}`}
                    data-side={side.key}
                    data-theme={theme}
                    data-hidden={hidden || undefined}
                  >
                    <p className={styles.paneLabel}>
                      {side.label}
                      {source.note && <span className={styles.paneNote}>{source.note}</span>}
                    </p>
                    <SectionBoundary name={label} onAsk={onAsk}>
                      {/* The live side is what the checks cover (see a11y.ts). */}
                      <div {...{ [CHECKED]: label }} style={{ display: "contents" }}>
                        <SpecimenBlocks
                          specimen={narrowed.specimen}
                          design={design}
                          frames={liveFrames(target, theme, side.key, alsoPhone)}
                        />
                      </div>
                    </SectionBoundary>
                  </div>
                );
              }
              if (source.kind === "pending") {
                return (
                  <div
                    key={side.key}
                    className={`ds-root ${styles.pane}`}
                    data-side={side.key}
                    data-theme={theme}
                    data-hidden={hidden || undefined}
                  >
                    <p className={styles.paneLabel}>{side.label}</p>
                    <p className={styles.notice}>Comes next.</p>
                  </div>
                );
              }
              return (
                <PastPane
                  key={side.key}
                  side={side}
                  version={source.version}
                  missing={source.missing}
                  rebasedNote={source.rebased}
                  live={live}
                  target={target}
                  label={label}
                  theme={theme}
                  hidden={hidden}
                  onAsk={onAsk}
                />
              );
            })}
          </div>
        </FlowSync.Provider>
      )}
    </section>
  );
}

interface PastPaneProps {
  side: Side;
  version: PastVersion | null;
  missing: string;
  rebasedNote: string;
  live: LoadedSpecimen;
  target: ReviewViewTarget;
  label: string;
  theme: "light" | "dark";
  hidden: boolean;
  onAsk: (prefix: string) => void;
}

/** A target as it was in a past version, running that version's code with its tokens. */
function PastPane({ side, version, missing, rebasedNote, live, target, label, theme, hidden, onAsk }: PastPaneProps) {
  const past = usePast(version?.base, live, target);
  return (
    // A form of its own, so radio groups here and in the other panes are separate groups.
    <form
      className={`ds-root ${styles.pane}`}
      data-side={side.key}
      data-theme={theme}
      data-hidden={hidden || undefined}
      onSubmit={preventSubmit}
    >
      <p className={styles.paneLabel}>
        {side.label}
        {past.state === "ready" && past.rebased && <span className={styles.paneNote}>{rebasedNote}</span>}
      </p>
      {!version || past.state === "loading" ? (
        <p className={styles.notice}>Preparing this version…</p>
      ) : past.state === "failed" ? (
        <div className="section-error" role="alert">
          <strong>This version could not be loaded</strong>
          <code>{past.message}</code>
        </div>
      ) : past.state === "none" ? (
        <p className={styles.notice}>{missing}</p>
      ) : (
        <SectionBoundary name={`${label} (${side.label.toLowerCase()})`} onAsk={onAsk} report={false}>
          <SpecimenBlocks
            specimen={past.specimen}
            design={version.design}
            frames={framesFor(target, theme, side.key)}
          />
        </SectionBoundary>
      )}
    </form>
  );
}

const preventSubmit = (event: FormEvent) => event.preventDefault();

/** The widths a review target asks for, as frames for one side of the review (in the theme on show). */
function framesFor(target: ReviewViewTarget, theme: "light" | "dark", side: string): Frames | undefined {
  if (!target.widths) return undefined;
  return { widths: target.widths, bothThemes: false, theme, side };
}

/** The live side's frames; with `phone`, phone width is added to what the target asks for. */
function liveFrames(target: ReviewViewTarget, theme: "light" | "dark", side: string, phone: boolean) {
  const frames = framesFor(target, theme, side);
  if (!phone) return frames;
  const widths = frames?.widths ?? ["fit"];
  return {
    widths: widths.includes("mobile") ? widths : [...widths, "mobile" as const],
    bothThemes: false,
    theme,
    side,
  };
}

/** A click on a pane switches sides in blink mode, unless it was meant for a control in the demo. */
function flipUnlessControl(event: MouseEvent, flip: () => void): void {
  const target = event.target as Element;
  if (target.closest("button, a, input, select, textarea, label, summary, [role='tab'], [role='button']")) return;
  flip();
}

type Past =
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
 * The target in a past version. When that version lacks it (the agent added
 * a block to show a state), today's specimen runs on that version's
 * components and tokens instead, so a new demo still compares old against new.
 */
function usePast(base: string | undefined, live: LoadedSpecimen, target: ReviewViewTarget): Past {
  const [past, setPast] = useState<Past>({ state: "loading" });
  const version = useHotVersion();
  const key = base ? `${base}|${live.file}|${live.id}|${JSON.stringify(target)}|${version}` : "";

  useEffect(() => {
    if (!base) return;
    let current = true;
    const narrowed = (specimen: LoadedSpecimen | null) => {
      const result = specimen ? narrowSpecimen(specimen, target) : null;
      return result && "specimen" in result ? result.specimen : null;
    };
    void (async () => {
      const found = narrowed(await loadPastSpecimen(base, live));
      if (found) return { state: "ready", specimen: found, rebased: false } as const;
      const rebased = narrowed(await loadRebasedSpecimen(base, live, version));
      return rebased ? ({ state: "ready", specimen: rebased, rebased: true } as const) : ({ state: "none" } as const);
    })().then(
      (next) => current && setPast(next),
      (error: unknown) => current && setPast({ state: "failed", message: describe(error) }),
    );
    return () => {
      current = false;
    };
    // key captures everything the effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return past;
}
