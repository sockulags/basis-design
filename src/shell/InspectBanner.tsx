import { useMemo, useState } from "react";
import type { Design } from "../../shared/design.ts";
import { diffDesigns } from "../../shared/diff.ts";
import type { HistoryEntry } from "../../shared/protocol.ts";
import { SOURCE_LABEL, when } from "./history.ts";
import styles from "./Shell.module.css";

interface InspectBannerProps {
  entry: HistoryEntry;
  snapshot: Design | undefined;
  current: Design;
  hasOlder: boolean;
  hasNewer: boolean;
  onStep: (direction: -1 | 1) => void;
  onRestore: () => void;
  onExit: () => void;
}

const LIST_LIMIT = 80;

function Value({ path, value }: { path: string; value: string | undefined }) {
  if (value === undefined) return <span className={styles.diffMissing}>—</span>;
  return (
    <span className={styles.diffValue}>
      {path.startsWith("color.") && <span className={styles.diffSwatch} style={{ background: value }} />}
      {value}
    </span>
  );
}

/** Shown while the preview displays a past version instead of the live one. */
export function InspectBanner({ entry, snapshot, current, hasOlder, hasNewer, onStep, onRestore, onExit }: InspectBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const changes = useMemo(() => (snapshot ? diffDesigns(current, snapshot) : []), [current, snapshot]);

  return (
    <div className={styles.inspect}>
      <div className={styles.inspectRow}>
        <div className={styles.inspectStep}>
          <button type="button" className={styles.chromeButton} onClick={() => onStep(-1)} disabled={!hasOlder} aria-label="Older version">
            ←
          </button>
          <button type="button" className={styles.chromeButton} onClick={() => onStep(1)} aria-label="Newer version">
            {hasNewer ? "→" : "→ Now"}
          </button>
        </div>
        <div className={styles.inspectText}>
          <strong>
            Viewing {SOURCE_LABEL[entry.source].toLowerCase()} · {when(entry.at)}
          </strong>
          {entry.label && <span className={styles.menuLabel}>“{entry.label}”</span>}
        </div>
        <button
          type="button"
          className={styles.inspectToggle}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          disabled={!snapshot || changes.length === 0}
        >
          {!snapshot ? "Loading…" : changes.length === 0 ? "Same as now" : `${changes.length} tokens differ from now`}
        </button>
        <button type="button" className={styles.primaryButton} onClick={onRestore} disabled={!snapshot || changes.length === 0}>
          Restore this version
        </button>
        <button type="button" className={styles.chromeButton} onClick={onExit}>
          Back to now
        </button>
      </div>
      {expanded && changes.length > 0 && (
        <div className={styles.diff}>
          <span className={styles.diffHead}>Token</span>
          <span className={styles.diffHead}>Now</span>
          <span className={styles.diffHead}>In this version</span>
          {changes.slice(0, LIST_LIMIT).map((change) => (
            <div key={change.path} className={styles.diffRow}>
              <span className={styles.diffPath}>{change.path}</span>
              <Value path={change.path} value={change.before} />
              <Value path={change.path} value={change.after} />
            </div>
          ))}
          {changes.length > LIST_LIMIT && <span className={styles.muted}>and {changes.length - LIST_LIMIT} more</span>}
        </div>
      )}
    </div>
  );
}
