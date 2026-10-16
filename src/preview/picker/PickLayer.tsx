import { useEffect, useState, type RefObject } from "react";
import { annotationLabel, type Annotation } from "../../../shared/annotations.ts";
import type { Design } from "../../../shared/design.ts";
import { annotate, pickable } from "./annotate.ts";
import styles from "./PickLayer.module.css";

export interface Pick {
  annotation: Annotation;
  element: HTMLElement;
}

interface PickLayerProps {
  container: RefObject<HTMLElement | null>;
  design: Design;
  picks: Pick[];
  onToggle: (annotation: Annotation, element: HTMLElement) => void;
  onDone: () => void;
}

interface Hover {
  rect: DOMRect;
  label: string;
}

/**
 * Pick mode: hovering the preview outlines the component under the cursor and
 * each click attaches it (or detaches it again) instead of interacting with it.
 */
export function PickLayer({ container, design, picks, onToggle, onDone }: PickLayerProps) {
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let current: HTMLElement | null = null;
    const picked = new Set(picks.map((pick) => pick.element));

    const describe = (el: HTMLElement) =>
      setHover({
        rect: el.getBoundingClientRect(),
        label: picked.has(el) ? "click to remove" : annotationLabel(annotate(el, design)),
      });

    const onMove = (event: PointerEvent) => {
      const el = pickable(event.target);
      current = el;
      if (el) describe(el);
      else setHover(null);
    };
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onClick = (event: MouseEvent) => {
      swallow(event);
      const el = pickable(event.target);
      if (el) onToggle(annotate(el, design), el);
    };
    const onScroll = () => {
      if (current) describe(current);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };

    if (current) describe(current);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerdown", swallow, true);
    root.addEventListener("mousedown", swallow, true);
    root.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll);
    window.addEventListener("keydown", onKey);
    root.dataset.picking = "true";
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", swallow, true);
      root.removeEventListener("mousedown", swallow, true);
      root.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
      delete root.dataset.picking;
    };
  }, [container, design, picks, onToggle, onDone]);

  return (
    <>
      <div className={styles.hint}>
        <span>
          {picks.length === 0 ? "Click components to attach them" : `${picks.length} picked · click again to remove`}
        </span>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
      {hover && (
        <div
          className={styles.outline}
          style={{ top: hover.rect.top - 3, left: hover.rect.left - 3, width: hover.rect.width + 6, height: hover.rect.height + 6 }}
        >
          <span className={styles.tag}>{hover.label}</span>
        </div>
      )}
    </>
  );
}

/** Numbered markers on every attached element, kept until the prompt is sent. */
export function PickMarkers({ picks }: { picks: Pick[] }) {
  const [, setFrame] = useState(0);

  useEffect(() => {
    let raf = 0;
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFrame((frame) => frame + 1));
    };
    window.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, []);

  return (
    <>
      {picks.map((pick, index) => {
        if (!pick.element.isConnected) return null;
        const rect = pick.element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
        return (
          <div
            key={index}
            className={styles.marker}
            style={{ top: rect.top - 3, left: rect.left - 3, width: rect.width + 6, height: rect.height + 6 }}
          >
            <span className={styles.badge}>{index + 1}</span>
          </div>
        );
      })}
    </>
  );
}
