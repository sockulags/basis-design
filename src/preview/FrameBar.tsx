import { useEffect, useState } from "react";
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
 * @container rules) and in both themes. At least one width stays on.
 */
export function FrameBar({ choice, onChange }: { choice: FrameChoice; onChange: (choice: FrameChoice) => void }) {
  const toggle = (width: FrameWidth) => {
    const on = choice.widths.includes(width);
    const widths = on ? choice.widths.filter((item) => item !== width) : [...choice.widths, width];
    onChange({ ...choice, widths: widths.length ? widths : ["fit"] });
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
          title={width.px ? `${width.px}px wide: patterns respond through @container rules` : "The column's own width"}
        >
          {width.label}
        </button>
      ))}
      <span className={styles.frameBarDivider} aria-hidden />
      <button
        type="button"
        className="ask-button"
        aria-pressed={choice.bothThemes}
        onClick={() => onChange({ ...choice, bothThemes: !choice.bothThemes })}
      >
        Both themes
      </button>
    </div>
  );
}
