import { useEffect, useRef, useState } from "react";
import type { Design } from "../../shared/design.ts";
import { previewCss } from "../../shared/tokens.ts";
import { onHotUpdate } from "./errors.ts";
import styles from "./Review.module.css";
import { SectionBoundary } from "./SectionBoundary.tsx";
import { loadPastSpecimen, SpecimenBlocks, type LoadedSpecimen } from "./specimens.tsx";

interface ImpactProps {
  baseline: { design: Design; base: string };
  /** Live specimens to check: every section except what the review already shows. */
  specimens: LoadedSpecimen[];
  design: Design;
  theme: "light" | "dark";
  /** Called with the ids of the sections that look different from the starting point, when that list changes. */
  onImpact: (ids: string[]) => void;
}

const SETTLE_MS = 400;
const MAX_WAIT_MS = 2500;
const MAX_NODES = 6000;

/** Computed styles that decide how a component looks; layout boxes included, so spacing changes count. */
const PROPERTIES = [
  "display",
  "width",
  "height",
  "padding",
  "margin",
  "gap",
  "color",
  "background-color",
  "background-image",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
  "outline-width",
  "outline-color",
  "outline-offset",
  "opacity",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration-line",
  "fill",
  "stroke",
];

/** Attributes that carry state or variant; ids, classes and generated references differ between the copies. */
const ATTRIBUTES = [
  "role",
  "type",
  "disabled",
  "checked",
  "data-ds",
  "data-variant",
  "data-state",
  "data-force",
  "aria-checked",
  "aria-selected",
  "aria-expanded",
  "aria-pressed",
  "aria-invalid",
];

/** FNV-1a over a section's structure, text and computed styles: equal hashes mean it looks the same. */
function fingerprint(root: Element): number {
  let hash = 0x811c9dc5;
  const add = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let node = walker.nextNode(); node && count < MAX_NODES; node = walker.nextNode(), count++) {
    if (node.nodeType === Node.TEXT_NODE) {
      add(node.textContent?.trim() ?? "");
      continue;
    }
    const element = node as Element;
    add(`<${element.tagName}`);
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null) add(` ${name}=${value}`);
    }
    const style = getComputedStyle(element);
    for (const property of PROPERTIES) add(`;${normalise(style.getPropertyValue(property))}`);
  }
  return hash >>> 0;
}

/** Element references such as fill: url(#gradient-«r3») use generated ids, which differ between the two copies. */
function normalise(value: string): string {
  return value.includes("url(") ? value.replace(/url\(\s*["']?#[^)]*\)/g, "url(#)") : value;
}

/**
 * Renders every other section twice, offscreen and without animation, as it
 * was when the review started and as it is now, and reports the sections
 * whose structure, text or computed styles differ. Tokens are global, so a
 * change aimed at one component can reach many others; this is how the user
 * sees that before approving.
 */
export function Impact({ baseline, specimens, design, theme, onImpact }: ImpactProps) {
  const root = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState<Map<string, LoadedSpecimen | null> | null>(null);
  const specimensKey = specimens.map((specimen) => `${specimen.file}|${specimen.id}`).join(",");
  const latest = useRef({ specimens, past, onImpact });
  const reported = useRef<string | null>(null);
  latest.current = { specimens, past, onImpact };

  useEffect(() => {
    let current = true;
    setPast(null);
    void Promise.all(
      specimens.map(
        async (specimen) => [specimen.id, await loadPastSpecimen(baseline.base, specimen).catch(() => null)] as const,
      ),
    ).then((entries) => current && setPast(new Map(entries)));
    return () => {
      current = false;
    };
    // specimensKey captures the files and ids the effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.base, specimensKey]);

  // Measure once things settle: after token or theme changes, hot updates and anything that re-renders inside.
  useEffect(() => {
    const container = root.current;
    if (!container || !past) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const { specimens: list, past: loaded, onImpact: report } = latest.current;
      if (!loaded) return;
      const changed = list
        .filter((specimen) => {
          const before = container.querySelector(`[data-side="baseline"] [data-impact="${specimen.id}"]`);
          const after = container.querySelector(`[data-side="now"] [data-impact="${specimen.id}"]`);
          // A section that did not exist at the starting point is new, which counts as changed.
          if (!before || !after || !loaded.get(specimen.id)) return true;
          return fingerprint(before) !== fingerprint(after);
        })
        .map((specimen) => specimen.id);
      const key = changed.join(",");
      if (key === reported.current) return;
      reported.current = key;
      report(changed);
    };
    // Live demos may never settle (a ticking progress bar), so measure at least every MAX_WAIT_MS.
    let waitingSince = 0;
    const schedule = () => {
      clearTimeout(timer);
      const now = Date.now();
      if (!waitingSince) waitingSince = now;
      const run = () => {
        waitingSince = 0;
        measure();
      };
      if (now - waitingSince >= MAX_WAIT_MS) run();
      else timer = setTimeout(run, SETTLE_MS);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    // CSS Module edits replace stylesheets in <head> without touching the sections themselves.
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const stop = onHotUpdate(schedule);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      stop();
    };
  }, [past, design, baseline.design, theme]);

  return (
    <div ref={root} className={styles.impact} aria-hidden inert>
      <style>{previewCss(baseline.design, '.ds-root[data-side="baseline"]')}</style>
      {/* A form of its own, so radio groups on the two sides do not uncheck each other. */}
      <form className="ds-root" data-side="baseline" data-theme={theme} onSubmit={(event) => event.preventDefault()}>
        {past &&
          specimens.map((specimen) => {
            const before = past.get(specimen.id);
            return before ? (
              <div key={specimen.id} data-impact={specimen.id}>
                <SectionBoundary name={`${specimen.title} (before)`} onAsk={() => undefined} report={false}>
                  <SpecimenBlocks specimen={before} design={baseline.design} />
                </SectionBoundary>
              </div>
            ) : null;
          })}
      </form>
      <div className="ds-root" data-side="now" data-theme={theme}>
        {past &&
          specimens.map((specimen) => (
            <div key={specimen.id} data-impact={specimen.id}>
              <SectionBoundary name={specimen.title} onAsk={() => undefined}>
                <SpecimenBlocks specimen={specimen} design={design} />
              </SectionBoundary>
            </div>
          ))}
      </div>
    </div>
  );
}
