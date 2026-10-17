import { useMemo, useState } from "react";
import type { Design } from "../../shared/design.ts";
import { diffDesigns } from "../../shared/diff.ts";
import type { HistoryEntry, Snapshot } from "../../shared/protocol.ts";
import { SOURCE_LABEL, when } from "./history.ts";
import styles from "./Shell.module.css";

interface InspectBannerProps {
  entry: HistoryEntry;
  snapshot: Snapshot | undefined;
  current: Design;
  hasOlder: boolean;
  hasNewer: boolean;
  onStep: (direction: -1 | 1) => void;
  onRestore: () => void;
  onExit: () => void;
}

const LIST_LIMIT = 80;

/** A token value in a diff, with a swatch for colours. */
export function Value({ path, value }: { path: string; value: string | undefined }) {
  if (value === undefined) return <span className={styles.diffMissing}>—</span>;
  return (
    <span className={styles.diffValue}>
      {path.startsWith("color.") && <span className={styles.diffSwatch} style={{ background: value }} />}
      {value}
    </span>
  );
}

function diffKind(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return undefined;
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return undefined;
}

/** Shown while the preview displays a past version instead of the live one. */
export function InspectBanner({
  entry,
  snapshot,
  current,
  hasOlder,
  hasNewer,
  onStep,
  onRestore,
  onExit,
}: InspectBannerProps) {
  const [expanded, setExpanded] = useState<"tokens" | "code" | null>(null);
  const changes = useMemo(() => (snapshot ? diffDesigns(current, snapshot.design) : []), [current, snapshot]);
  const files = snapshot?.files ?? [];
  const same = changes.length === 0 && files.length === 0;
  const toggle = (panel: "tokens" | "code") => setExpanded((value) => (value === panel ? null : panel));

  return (
    <div className={styles.inspect}>
      <div className={styles.inspectRow}>
        <div className={styles.inspectStep}>
          <button
            type="button"
            className={styles.chromeButton}
            onClick={() => onStep(-1)}
            disabled={!hasOlder}
            aria-label="Older version"
          >
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
        {!snapshot ? (
          <span className={styles.muted}>Loading…</span>
        ) : same ? (
          <span className={styles.muted}>Same as now</span>
        ) : (
          <>
            <button
              type="button"
              className={styles.inspectToggle}
              onClick={() => toggle("tokens")}
              aria-expanded={expanded === "tokens"}
              disabled={changes.length === 0}
            >
              {changes.length} {changes.length === 1 ? "token differs" : "tokens differ"}
            </button>
            <button
              type="button"
              className={styles.inspectToggle}
              onClick={() => toggle("code")}
              aria-expanded={expanded === "code"}
              disabled={files.length === 0}
              title="The preview always runs today's component code; restore to bring this version's code back."
            >
              {files.length} component {files.length === 1 ? "file differs" : "files differ"}
            </button>
          </>
        )}
        <button type="button" className={styles.primaryButton} onClick={onRestore} disabled={!snapshot || same}>
          Restore this version
        </button>
        <button type="button" className={styles.chromeButton} onClick={onExit}>
          Back to now
        </button>
      </div>
      {expanded === "code" && snapshot && (
        <div className={styles.codeDiff}>
          <p className={styles.muted}>
            The preview shows this version's tokens with today's component code. Lines marked + are what restoring
            brings back.
          </p>
          <pre>
            {snapshot.codeDiff.split("\n").map((line, index) => (
              <span key={index} data-kind={diffKind(line)}>
                {line}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
      )}
      {expanded === "tokens" && changes.length > 0 && (
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
