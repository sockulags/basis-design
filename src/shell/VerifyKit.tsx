import { useState } from "react";
import type { ClientMessage, VerifyKitResult } from "../../shared/protocol.ts";
import { BrowseButton } from "./FolderField.tsx";
import { readPref, writePref } from "./prefs.ts";
import styles from "./Shell.module.css";

export interface VerifyKitProps {
  workspace: string;
  /** The product repo the project designs for: where the kit belongs, unless the user chose a folder before. */
  repo: string | undefined;
  progress: { step: string; done?: number; total?: number } | null;
  result: VerifyKitResult | null;
  send: (message: ClientMessage) => void;
}

/** The product folder the kit was last written to, per project. */
const targetPref = (workspace: string) => `verify-target:${workspace}`;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The verification kit tab of the Export dialog: builds the kit (a runnable copy of the design, screenshots of
 * every view's screens and the scripts that check an implementation against them) as a zip or into the product's
 * folder.
 */
export function VerifyKit({ workspace, repo, progress, result: latest, send }: VerifyKitProps) {
  const [target, setTarget] = useState(() => readPref(targetPref(workspace)) ?? repo ?? "");
  const [browseError, setBrowseError] = useState<string | null>(null);
  // Only show results of kits built while this dialog is open.
  const [stale] = useState(latest);
  const result = latest === stale ? null : latest;
  const busy = progress !== null;

  const build = (project?: string) => {
    if (project !== undefined) writePref(targetPref(workspace), project);
    send({ type: "verify-kit", project });
  };

  return (
    <div className={styles.kit}>
      <p className={styles.kitIntro}>
        Proof that a feature was built as designed. The kit holds a runnable copy of the design, screenshots of every
        view's screens at the widths the view asks for, and two scripts: one captures the implementation the same way,
        the other compares the images pixel for pixel. Give it to the agent that builds the feature; the target is 0%
        difference, and anything allowed to differ is a named exception.
      </p>
      <form
        className={styles.kitWrite}
        onSubmit={(event) => {
          event.preventDefault();
          build(target);
        }}
      >
        <label htmlFor="verify-target">Write into the product's folder</label>
        <div className={styles.kitWriteRow}>
          <input
            id="verify-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Browse, or paste the folder's path"
            spellCheck={false}
          />
          <BrowseButton
            title="Choose the product's folder"
            start={target}
            onPick={setTarget}
            onError={setBrowseError}
          />
          <button type="submit" className={styles.chromeButton} disabled={!target.trim() || busy}>
            Write kit
          </button>
        </div>
        <span className={styles.kitNote}>
          The kit goes into <code>basis-verify/</code> there. Writing it again replaces what Basis generated and keeps
          the project's targets, exceptions and captures.
        </span>
        {browseError && <p className={styles.kitError}>{browseError}</p>}
      </form>
      {progress && (
        <p className={styles.kitNote} role="status">
          {progress.step}
          {progress.total ? ` ${progress.done ?? 0} of ${progress.total}` : ""}…
        </p>
      )}
      {result && !result.ok && <p className={styles.kitError}>{result.error}</p>}
      {result?.ok && <Summary result={result} />}
    </div>
  );
}

function Summary({ result }: { result: Extract<VerifyKitResult, { ok: true }> }) {
  const { summary, dir } = result;
  if (summary.views === 0) {
    return (
      <p className={styles.kitWarning}>
        There are no views to capture. Ask the agent for a view of a screen in the product, then build the kit.
      </p>
    );
  }
  return (
    <>
      <p className={styles.kitSuccess}>
        Captured {plural(summary.shots, "shot")} of {plural(summary.screens, "screen")} in{" "}
        {plural(summary.views, "view")} with {summary.browser}.{" "}
        {dir ? (
          <>
            Wrote the kit to <code>{dir}</code>.
          </>
        ) : (
          <a href="/export/verification-kit.zip" download>
            Download the .zip
          </a>
        )}
      </p>
      {summary.failed.length > 0 && (
        <p className={styles.kitWarning}>
          {plural(summary.failed.length, "shot")} of screens that failed to render: {summary.failed.join(", ")}.
        </p>
      )}
      {summary.unstable.length > 0 && (
        <p className={styles.kitWarning}>
          {plural(summary.unstable.length, "shot")} came out differently on a second capture, so nothing can match them
          exactly: {summary.unstable.join(", ")}. Look for clocks, random values or animations in those screens.
        </p>
      )}
      {summary.problems.length > 0 && (
        <p className={styles.kitWarning}>Specimens that could not be loaded: {summary.problems.join("; ")}.</p>
      )}
    </>
  );
}
