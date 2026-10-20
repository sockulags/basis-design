import { useRef, useState } from "react";
import { KIT_FOLDER, kitFolder, viewKitFolder } from "../../shared/capture.ts";
import { kitPrompt } from "../../shared/kit-prompt.ts";
import type { ClientMessage, VerifyKitResult } from "../../shared/protocol.ts";
import { BrowseButton } from "./FolderField.tsx";
import { readPref, writePref } from "./prefs.ts";
import styles from "./Shell.module.css";

/** A view of the design, as the Views page lists it. */
export interface KitView {
  id: string;
  title: string;
}

export interface VerifyKitProps {
  workspace: string;
  /** The design's views, to choose from. */
  views: KitView[];
  choice: ViewChoice;
  /** The product repo the project designs for: where the kit belongs, unless the user chose a folder before. */
  repo: string | undefined;
  progress: { step: string; done?: number; total?: number } | null;
  result: VerifyKitResult | null;
  send: (message: ClientMessage) => void;
}

/** The product folder the kit was last written to, per project. */
const targetPref = (workspace: string) => `verify-target:${workspace}`;
/** Whether writing the kit also installs its skill in the product's .claude/skills/, per project. */
const skillPref = (workspace: string) => `verify-skill:${workspace}`;
/** The views last chosen for the kit, per project: their ids as JSON, or empty for every view. */
const viewsPref = (workspace: string) => `verify-views:${workspace}`;

function storedViews(workspace: string): string[] | null {
  try {
    const stored: unknown = JSON.parse(readPref(viewsPref(workspace)) || "null");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/** Which views go into the kit, and the kit's folder in the product. */
export interface ViewChoice {
  chosen: Set<string>;
  toggle: (id: string) => void;
  setAll: (all: boolean) => void;
  folder: string;
  setFolder: (folder: string) => void;
  /** False when the folder is not one a kit can go into (kitFolder). */
  folderValid: boolean;
  /** Whether there is a kit to build: some view chosen (when there are views) and a valid folder. */
  ready: boolean;
  /** What the kit is built from: the chosen ids (undefined for every view) and the folder. */
  request: { views?: string[]; folder: string };
}

/**
 * The views chosen for the kit, remembered per project. Every view until the user picks some, so views added
 * later are in the kit too; checking them all goes back to that. Chosen views that are gone are dropped, and when
 * none of them is left, every view is chosen again. The folder is the one Basis suggests for the choice (a view's
 * own under basis-verify/, so kits of views never replace each other) until the user types another, which lasts
 * until the choice changes.
 */
export function useViewChoice(workspace: string, views: KitView[]): ViewChoice {
  const [stored, setStored] = useState(() => storedViews(workspace));
  const [typed, setTyped] = useState<{ choice: string; folder: string } | null>(null);
  const ids = views.map((view) => view.id);
  const kept = stored?.filter((id) => ids.includes(id));
  const chosen = new Set(!kept || (kept.length === 0 && stored!.length > 0) ? ids : kept);
  const key = [...chosen].sort().join("\n");
  // A view picked out of several gets its own folder; all of them, one or many, share basis-verify/.
  const suggested = chosen.size === 1 && ids.length > 1 ? viewKitFolder([...chosen][0]!) : KIT_FOLDER;
  const folder = typed?.choice === key ? typed.folder : suggested;
  const valid = kitFolder(folder);
  const store = (next: string[] | null) => {
    const value = next && next.length === ids.length ? null : next;
    setStored(value);
    writePref(viewsPref(workspace), value ? JSON.stringify(value) : "");
  };
  return {
    chosen,
    toggle: (id) => store(chosen.has(id) ? [...chosen].filter((other) => other !== id) : [...chosen, id]),
    setAll: (all) => store(all ? null : []),
    folder,
    setFolder: (value) => setTyped({ choice: key, folder: value }),
    folderValid: valid !== null,
    ready: valid !== null && (ids.length === 0 || chosen.size > 0),
    request: { views: chosen.size === ids.length ? undefined : [...chosen], folder: valid ?? KIT_FOLDER },
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The verification kit tab of the Export dialog: builds the kit (a runnable copy of the design, screenshots of the
 * chosen views' screens and the scripts that check an implementation against them) as a zip or into the product's
 * folder.
 */
export function VerifyKit({ workspace, views, choice, repo, progress, result: latest, send }: VerifyKitProps) {
  const [target, setTarget] = useState(() => readPref(targetPref(workspace)) ?? repo ?? "");
  const [skill, setSkill] = useState(() => readPref(skillPref(workspace)) === "true");
  const [browseError, setBrowseError] = useState<string | null>(null);
  // Only show results of kits built while this dialog is open.
  const [stale] = useState(latest);
  const result = latest === stale ? null : latest;
  const busy = progress !== null;

  const build = (project?: string) => {
    if (project !== undefined) writePref(targetPref(workspace), project);
    send({ type: "verify-kit", project, skill: project !== undefined && skill, ...choice.request });
  };

  return (
    <div className={styles.kit}>
      <p className={styles.kitIntro}>
        Proof that a feature was built as designed. The kit holds a runnable copy of the design, screenshots of the
        chosen views' screens at the widths each view asks for, and two scripts: one captures the implementation the
        same way, the other compares the images pixel for pixel. Give it to the agent that builds the feature; the
        target is 0% difference, and anything allowed to differ is a named exception.
      </p>
      {views.length > 0 && <ViewPicker views={views} choice={choice} />}
      <div className={styles.kitWrite}>
        <label htmlFor="verify-folder">Kit folder in the product</label>
        <div className={styles.kitWriteRow}>
          <input
            id="verify-folder"
            value={choice.folder}
            onChange={(event) => choice.setFolder(event.target.value)}
            aria-invalid={!choice.folderValid}
            aria-describedby="verify-folder-note"
            spellCheck={false}
          />
        </div>
        {choice.folderValid ? (
          <span id="verify-folder-note" className={styles.kitNote}>
            Relative to the product repo's root. A kit of one view gets that view's own folder, so kits of different
            views never replace each other.
          </span>
        ) : (
          <span id="verify-folder-note" className={styles.kitError}>
            Use a path inside the product, such as <code>basis-verify/web-12</code>: letters, digits, <code>.</code>,{" "}
            <code>_</code> and <code>-</code>, without <code>..</code>.
          </span>
        )}
      </div>
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
          <button type="submit" className={styles.chromeButton} disabled={!target.trim() || busy || !choice.ready}>
            Write kit
          </button>
        </div>
        <span className={styles.kitNote}>
          The kit goes into <code>{choice.request.folder}/</code> there. Writing a kit into the same folder again
          replaces what Basis generated in it, and keeps the project's targets, exceptions and captures.
        </span>
        <label className={styles.projectCheck}>
          <input
            type="checkbox"
            checked={skill}
            onChange={(event) => {
              setSkill(event.target.checked);
              writePref(skillPref(workspace), String(event.target.checked));
            }}
          />
          <span>
            Also install the kit's skill for Claude Code as <code>.claude/skills/basis-verify/SKILL.md</code> (a file
            there that Basis did not write is left alone)
          </span>
        </label>
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

/** Checkboxes for the views in the kit, with one for all of them. */
function ViewPicker({ views, choice }: { views: KitView[]; choice: ViewChoice }) {
  const all = choice.chosen.size === views.length;
  return (
    <fieldset className={styles.kitViews}>
      <legend>Views in the kit</legend>
      <label className={styles.kitViewCheck}>
        <input
          type="checkbox"
          checked={all}
          ref={(input) => {
            if (input) input.indeterminate = !all && choice.chosen.size > 0;
          }}
          onChange={(event) => choice.setAll(event.target.checked)}
        />
        <span>
          All views <span className={styles.muted}>({views.length})</span>
        </span>
      </label>
      <div className={styles.kitViewList}>
        {views.map((view) => (
          <label key={view.id} className={styles.kitViewCheck}>
            <input type="checkbox" checked={choice.chosen.has(view.id)} onChange={() => choice.toggle(view.id)} />
            <span>{view.title}</span>
          </label>
        ))}
      </div>
      {choice.chosen.size === 0 && <span className={styles.kitError}>Choose at least one view.</span>}
    </fieldset>
  );
}

function Summary({ result }: { result: Extract<VerifyKitResult, { ok: true }> }) {
  const { summary, dir, skill } = result;
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
          <>
            <a href="/export/verification-kit.zip" download>
              Download the .zip
            </a>{" "}
            and unpack it at the root of the product's repo.
          </>
        )}
      </p>
      {skill && (
        <p className={skill.written ? styles.kitNote : styles.kitWarning}>
          {skill.written ? (
            <>
              Installed the skill as <code>{skill.file}</code>.
            </>
          ) : (
            <>
              Left <code>{skill.file}</code> alone: Basis did not write it. Delete it to have Basis install its own.
            </>
          )}
        </p>
      )}
      <CopyPrompt views={summary.viewList} zip={!dir} folder={summary.folder} />
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
      {summary.remote.length > 0 && (
        <p className={styles.kitWarning}>
          {plural(summary.remote.length, "shot")} {summary.remote.length === 1 ? "loads" : "load"} images from other
          sites, which can change or vanish before the implementation is compared: {summary.remote.join(", ")}. Use
          placeholders in <code>views/assets/</code> marked <code>data-basis-media</code>.
        </p>
      )}
      {summary.problems.length > 0 && (
        <p className={styles.kitWarning}>Specimens that could not be loaded: {summary.problems.join("; ")}.</p>
      )}
    </>
  );
}

/** The prompt for the agent that builds the design in the product, for one view or all, ready to copy. */
function CopyPrompt({ views, zip, folder }: { views: { id: string; title: string }[]; zip: boolean; folder: string }) {
  const [view, setView] = useState("");
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const text = useRef<HTMLPreElement>(null);
  // With one view there is nothing to choose: the prompt names it.
  const prompt = kitPrompt({ views, view: views.length === 1 ? views[0]!.id : view || undefined, zip, folder });

  const copy = () => {
    // Say so at once; the clipboard answers in a moment, and only a refusal changes the label again.
    setCopied("yes");
    navigator.clipboard.writeText(prompt).catch(() => {
      setCopied("failed");
      if (text.current) getSelection()?.selectAllChildren(text.current);
    });
  };

  return (
    <div className={styles.kitPrompt}>
      <div className={styles.kitPromptRow}>
        <span>Prompt for the agent that builds it</span>
        {views.length > 1 && (
          <select
            aria-label="View to build"
            value={view}
            onChange={(event) => {
              setView(event.target.value);
              setCopied(null);
            }}
          >
            <option value="">All views</option>
            {views.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
        <button type="button" className={styles.chromeButton} onClick={copy}>
          {copied === "yes" ? "Copied" : "Copy prompt"}
        </button>
      </div>
      <pre ref={text} aria-label="Prompt for the agent">
        {prompt}
      </pre>
      {copied === "failed" && (
        <p className={styles.kitError}>
          The browser did not allow copying. The text is selected; copy it from the keyboard.
        </p>
      )}
    </div>
  );
}
