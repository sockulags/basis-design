import type { ReactNode } from "react";
import type { Design } from "../../shared/design.ts";
import styles from "./Overview.module.css";
import { flowScreens, SpecimenBlocks, type LoadedSpecimen } from "./specimens.tsx";

/*
 * A page as an overview: a card for every section (a foundation, a component, a pattern, a view), grouped as the
 * sidebar groups them, each with a small still picture of its first block, so the whole design system is in view
 * without scrolling through it. A card opens its section alone.
 */

/** One section of a page, as a card and as what its own page shows. */
export interface PageEntry {
  id: string;
  title: string;
  group: string;
  description: string;
  specimen?: LoadedSpecimen;
  /** Basis' own sections (the foundations) draw their own card picture. */
  picture?: ReactNode;
  /** What the card says it holds: "4 screens", "3 blocks". */
  meta?: string;
}

export function entryMeta(specimen: LoadedSpecimen): string {
  const screens = flowScreens(specimen).length;
  if (screens) return `${screens} ${screens === 1 ? "screen" : "screens"}`;
  const blocks = specimen.blocks.length;
  return `${blocks} ${blocks === 1 ? "block" : "blocks"}`;
}

/** The first block of a specimen, still and small: not clickable, not focusable, not checked. */
function Thumbnail({ specimen, design }: { specimen: LoadedSpecimen; design: Design }) {
  const first = { ...specimen, blocks: specimen.blocks.slice(0, 1) };
  return (
    <div className={styles.thumb} aria-hidden="true" inert>
      <div className={styles.thumbInner}>
        <SpecimenBlocks specimen={first} design={design} />
      </div>
    </div>
  );
}

export function Overview({
  entries,
  design,
  onOpen,
}: {
  entries: PageEntry[];
  design: Design;
  onOpen: (id: string) => void;
}) {
  const groups = [...new Set(entries.map((entry) => entry.group))];
  return (
    <div className={styles.overview}>
      {groups.map((group) => (
        <section key={group} className={styles.group} aria-label={group}>
          <h2 className={styles.groupTitle}>{group}</h2>
          <ul className={styles.cards}>
            {entries
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <li key={entry.id}>
                  <button type="button" className={styles.card} onClick={() => onOpen(entry.id)}>
                    {entry.specimen ? (
                      <Thumbnail specimen={entry.specimen} design={design} />
                    ) : (
                      <div className={styles.thumb} aria-hidden="true">
                        {entry.picture}
                      </div>
                    )}
                    <span className={styles.cardText}>
                      <span className={styles.cardTitle}>{entry.title}</span>
                      {entry.description && <span className={styles.cardDescription}>{entry.description}</span>}
                      {entry.meta && <span className={styles.cardMeta}>{entry.meta}</span>}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The pictures of the foundations' cards, drawn with the design's own tokens. */
export const FOUNDATION_PICTURES: Record<string, ReactNode> = {
  color: (
    <span className={styles.swatches}>
      {["primary", "secondary", "accent", "success", "warning", "danger"].map((role) => (
        <span key={role} style={{ background: `var(--color-${role})` }} />
      ))}
    </span>
  ),
  typography: <span className={styles.glyph}>Aa</span>,
  shape: (
    <span className={styles.shapes}>
      {["sm", "md", "lg", "full"].map((radius) => (
        <span key={radius} style={{ borderRadius: `var(--radius-${radius})` }} />
      ))}
    </span>
  ),
  motion: (
    <svg className={styles.curve} viewBox="0 0 100 50" aria-hidden="true">
      <path d="M4 46 C 40 46, 50 4, 96 4" />
    </svg>
  ),
};
