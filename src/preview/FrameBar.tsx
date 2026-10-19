import { useEffect, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  DEFAULT_WIDTHS,
  MAX_PROJECT_WIDTH,
  MIN_PROJECT_WIDTH,
  sameWidths,
  WIDTH_LABELS,
  WIDTH_NAMES,
  widthsProblem,
  type WidthName,
  type Widths,
} from "../../shared/widths.ts";
import styles from "./Preview.module.css";
import { FRAME_WIDTHS, type FrameWidth } from "./specimens.tsx";

export interface FrameChoice {
  widths: FrameWidth[];
  bothThemes: boolean;
}

const KEY = "basis:frames";
const DEFAULT: FrameChoice = { widths: ["fit"], bothThemes: false };

function read(): FrameChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<FrameChoice> | null;
    const widths = (raw?.widths ?? []).filter((width): width is FrameWidth =>
      FRAME_WIDTHS.some((item) => item.id === width),
    );
    return { widths: widths.length ? widths : DEFAULT.widths, bothThemes: raw?.bothThemes === true };
  } catch {
    return DEFAULT;
  }
}

/** The widths and themes the gallery shows each block at, remembered in this browser. */
export function useFrameChoice(): [FrameChoice, (choice: FrameChoice) => void] {
  const [choice, setChoice] = useState(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(choice));
    } catch {
      // Only a convenience for next time.
    }
  }, [choice]);
  return [choice, setChoice];
}

/**
 * Shows every block at chosen widths (each a size container, for patterns with
 * @container rules) and in both themes. At least one width stays on. The
 * project's widths for Mobile, Tablet and Desktop are changed from here too.
 */
export function FrameBar({
  choice,
  onChange,
  widths,
  onWidths,
}: {
  choice: FrameChoice;
  onChange: (choice: FrameChoice) => void;
  /** The project's widths. */
  widths: Widths;
  /** Sets the project's widths, or with null goes back to Basis' defaults. */
  onWidths: (widths: Widths | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const toggle = (width: FrameWidth) => {
    const on = choice.widths.includes(width);
    const next = on ? choice.widths.filter((item) => item !== width) : [...choice.widths, width];
    onChange({ ...choice, widths: next.length ? next : ["fit"] });
  };
  return (
    <div className={styles.frameBar} role="toolbar" aria-label="Widths and themes">
      <span className={styles.frameBarLabel}>Show at</span>
      {FRAME_WIDTHS.map((width) => (
        <button
          key={width.id}
          type="button"
          className="ask-button"
          aria-pressed={choice.widths.includes(width.id)}
          onClick={() => toggle(width.id)}
          title={
            width.id === "fit"
              ? "The column's own width"
              : `${widths[width.id]}px wide: patterns respond through @container rules`
          }
        >
          {width.label}
        </button>
      ))}
      <button
        type="button"
        className={`ask-button ${styles.widthsButton}`}
        aria-expanded={editing}
        aria-controls="basis-widths"
        aria-label={`The project's widths: ${WIDTH_NAMES.map((name) => `${WIDTH_LABELS[name]} ${widths[name]}`).join(", ")} px. Change them`}
        title="The project's widths for Mobile, Tablet and Desktop"
        onClick={() => setEditing((open) => !open)}
      >
        {WIDTH_NAMES.map((name) => widths[name]).join(" · ")}
      </button>
      <span className={styles.frameBarDivider} aria-hidden />
      <button
        type="button"
        className="ask-button"
        aria-pressed={choice.bothThemes}
        onClick={() => onChange({ ...choice, bothThemes: !choice.bothThemes })}
      >
        Both themes
      </button>
      {editing && <WidthsEditor widths={widths} onWidths={onWidths} onClose={() => setEditing(false)} />}
    </div>
  );
}

type Draft = Record<WidthName, string>;

const draftOf = (widths: Widths): Draft => ({
  mobile: String(widths.mobile),
  tablet: String(widths.tablet),
  desktop: String(widths.desktop),
});

/**
 * The project's widths, one field each. A change applies when a field is left or Enter is pressed, if the three
 * make a usable set (shared/widths.ts); otherwise the reason shows and nothing changes. Reset goes back to Basis'
 * defaults, Esc puts the fields back and closes.
 */
function WidthsEditor({
  widths,
  onWidths,
  onClose,
}: {
  widths: Widths;
  onWidths: (widths: Widths | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(widths));
  const [problem, setProblem] = useState<string | null>(null);
  // The widths Basis has now, from this control or another tab.
  const key = WIDTH_NAMES.map((name) => widths[name]).join(",");
  useEffect(() => {
    setDraft(draftOf(widths));
    setProblem(null);
    // key captures widths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const apply = () => {
    const next: Widths = {
      mobile: Number(draft.mobile.trim() || NaN),
      tablet: Number(draft.tablet.trim() || NaN),
      desktop: Number(draft.desktop.trim() || NaN),
    };
    const reason = widthsProblem(next);
    setProblem(reason);
    if (!reason && !sameWidths(next, widths)) onWidths(next);
  };
  // Leaving a field for another of the three applies too; leaving the editor does as well.
  const blur = (event: FocusEvent<HTMLInputElement>) => {
    const editor = event.currentTarget.closest("#basis-widths");
    if (event.relatedTarget instanceof HTMLInputElement && editor?.contains(event.relatedTarget)) return;
    apply();
  };
  // Keys rather than a form's submit: the preview's sandbox does not allow forms to submit.
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  const defaults = sameWidths(widths, DEFAULT_WIDTHS);
  return (
    <div
      id="basis-widths"
      className={styles.widthsEditor}
      role="group"
      aria-label="The project's widths"
      onKeyDown={keyDown}
    >
      {WIDTH_NAMES.map((name) => (
        <label key={name} className={styles.widthsField}>
          {WIDTH_LABELS[name]}
          <input
            type="number"
            inputMode="numeric"
            min={MIN_PROJECT_WIDTH}
            max={MAX_PROJECT_WIDTH}
            step={1}
            aria-label={`${WIDTH_LABELS[name]} (px)`}
            value={draft[name]}
            aria-invalid={problem?.startsWith(WIDTH_LABELS[name]) || undefined}
            aria-describedby="basis-widths-note"
            onChange={(event) => setDraft((current) => ({ ...current, [name]: event.target.value }))}
            onBlur={blur}
          />
          px
        </label>
      ))}
      <button type="button" className="ask-button" disabled={defaults} onClick={() => onWidths(null)}>
        Reset to {WIDTH_NAMES.map((name) => DEFAULT_WIDTHS[name]).join(", ")}
      </button>
      <button type="button" className="ask-button" onClick={onClose}>
        Done
      </button>
      <p id="basis-widths-note" className={styles.widthsNote} role="status" data-problem={problem ? true : undefined}>
        {problem ??
          `Saved with the project. From ${MIN_PROJECT_WIDTH} to ${MAX_PROJECT_WIDTH}px, each narrower than the next.`}
      </p>
    </div>
  );
}
