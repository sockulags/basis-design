import { Fragment, type ReactNode } from "react";
import styles from "./Gallery.module.css";
import { SectionBoundary } from "./SectionBoundary.tsx";

interface SectionProps {
  id: string;
  title: string;
  description: string;
  onAsk: (prefix: string) => void;
  children: ReactNode;
}

export function Section({ id, title, description, onAsk, children }: SectionProps) {
  return (
    <section id={id} className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionDescription}>{description}</p>
        </div>
        <button type="button" className="ask-button" onClick={() => onAsk(`${title}: `)}>
          Refine with agent
        </button>
      </header>
      <SectionBoundary name={title} onAsk={onAsk}>
        {children}
      </SectionBoundary>
    </section>
  );
}

export function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <h3 className={styles.groupTitle}>{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

export interface Axis<T extends string> {
  id: T;
  label: string;
}

interface MatrixProps<R extends string, C extends string> {
  rows: readonly Axis<R>[];
  cols: readonly Axis<C>[];
  render: (row: R, col: C) => ReactNode;
  minCol?: number;
}

/** Rows × states grid. Each cell renders the component pinned to that state. */
export function Matrix<R extends string, C extends string>({ rows, cols, render, minCol = 110 }: MatrixProps<R, C>) {
  return (
    // Focusable, so a matrix wider than its column can be scrolled from the keyboard.
    <div className={styles.matrixScroll} tabIndex={0}>
      <div
        className={styles.matrix}
        style={{ gridTemplateColumns: `minmax(84px, max-content) repeat(${cols.length}, minmax(${minCol}px, 1fr))` }}
      >
        <span />
        {cols.map((col) => (
          <span key={col.id} className={styles.colHead}>
            {col.label}
          </span>
        ))}
        {rows.map((row) => (
          <Fragment key={row.id}>
            <span className={styles.rowHead}>{row.label}</span>
            {cols.map((col) => (
              <div key={col.id} className={styles.cell} data-row={row.label} data-col={col.label}>
                {render(row.id, col.id)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen} data-state-label={label}>
      <div className={styles.specimenBody}>{children}</div>
      <span className={styles.caption}>{label}</span>
    </div>
  );
}

export function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return (
    <div className={styles.row} data-wrap={wrap || undefined}>
      {children}
    </div>
  );
}

/** A pattern's data states, each labelled, one under the other at full width. */
export function States({ states }: { states: { label: string; content: ReactNode }[] }) {
  return (
    <div className={styles.states}>
      {states.map((state, index) => (
        <div key={`${state.label}-${index}`} className={styles.state} data-state-label={state.label}>
          <span className={styles.caption}>{state.label}</span>
          {state.content}
        </div>
      ))}
    </div>
  );
}

export function Grid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div className={styles.grid} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))` }}>
      {children}
    </div>
  );
}

export function Token({ children }: { children: ReactNode }) {
  return <code className={styles.token}>{children}</code>;
}
