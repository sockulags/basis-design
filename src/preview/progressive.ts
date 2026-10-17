import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** Sections rendered right away: enough to fill the first screen. */
const FIRST = 6;
/** Sections added per step after that; each step is its own task, so the page stays responsive. */
const STEP = 6;

/** Asks the gallery to render every section up to `id` now, so scrolling to it lands where it ends up. */
export const REVEAL_EVENT = "basis:reveal";

let rendering = false;

/**
 * True while sections are still being added. A smooth scroll is cancelled by
 * the layout changes each step makes, so scrolling jumps instead until then.
 */
export function stillRendering(): boolean {
  return rendering;
}

/**
 * How many of a page's sections are rendered. A large gallery renders its
 * first screen at once and the rest a few sections per task, instead of
 * blocking on all of them; nothing is unmounted afterwards, so every section
 * still reports its render errors to the fix loop and live demos keep their
 * state. While the tab is hidden nobody sees the work, so everything renders
 * in one go (background tabs throttle timers to a crawl).
 */
export function useProgressiveCount(total: number, page: string): [count: number, reveal: (index: number) => void] {
  const [count, setCount] = useState(() => (document.hidden ? Infinity : FIRST));

  // A new page starts from its first screen again.
  useEffect(() => {
    setCount(document.hidden ? Infinity : FIRST);
  }, [page]);

  useEffect(() => {
    rendering = count < total;
    if (count >= total) return;
    const timer = setTimeout(() => setCount((current) => (document.hidden ? Infinity : current + STEP)), 0);
    return () => clearTimeout(timer);
  }, [count, total]);

  /** Renders everything up to and including `index` before returning. */
  const reveal = useCallback((index: number) => {
    flushSync(() => setCount((current) => Math.max(current, index + 1)));
  }, []);

  return [count, reveal];
}

/** Lets anything in the preview ask for a section to be rendered before it scrolls there. */
export function requestReveal(id: string): void {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
}

export function onReveal(listener: (id: string) => void): () => void {
  const handle = (event: Event) => listener(String((event as CustomEvent).detail));
  window.addEventListener(REVEAL_EVENT, handle);
  return () => window.removeEventListener(REVEAL_EVENT, handle);
}
