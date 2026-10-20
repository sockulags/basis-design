import { useEffect, useMemo, useRef, useState } from "react";
import type { Design } from "../../shared/design.ts";
import type { ClientMessage, ExportWriteResult } from "../../shared/protocol.ts";
import { exportCss, exportJson, exportTailwind } from "../../shared/tokens.ts";
import { BrowseButton } from "./FolderField.tsx";
import { readPref, writePref } from "./prefs.ts";
import styles from "./Shell.module.css";
import { useViewChoice, VerifyKit, type VerifyKitProps } from "./VerifyKit.tsx";

const FORMATS = [
  { id: "css", label: "CSS variables", file: "tokens.css", type: "text/css", build: exportCss },
  { id: "tailwind", label: "Tailwind v4", file: "theme.tailwind.css", type: "text/css", build: exportTailwind },
  { id: "json", label: "JSON", file: "design-system.json", type: "application/json", build: exportJson },
] as const;

type Tab = "kit" | "verify" | (typeof FORMATS)[number]["id"];

interface ExportDialogProps {
  design: Design;
  /** The project the starter kit's download is of. */
  projectId?: string;
  workspace: string;
  /** Number of open problems in the workspace; exporting still works, but the user should know. */
  problems: number;
  manifest: { folder: string; files: { path: string; bytes: number }[] } | null;
  result: ExportWriteResult | null;
  send: (message: ClientMessage) => void;
  onClose: () => void;
  verify: Omit<VerifyKitProps, "workspace" | "send" | "choice">;
}

/** The folder the kit was last written to, remembered per project so one never writes into another's. */
const targetPref = (workspace: string) => `export-target:${workspace}`;

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

function StarterKit({
  workspace,
  problems,
  manifest,
  result: latest,
  send,
}: Pick<ExportDialogProps, "workspace" | "problems" | "manifest" | "result" | "send">) {
  const [target, setTarget] = useState(() => readPref(targetPref(workspace)) ?? "");
  const [pending, setPending] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  // Only show results of writes made while this dialog is open.
  const [stale] = useState(latest);
  const result = latest === stale ? null : latest;
  const total = manifest?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0;
  const conflicts = result && !result.ok && result.conflicts.length > 0 ? result : null;

  useEffect(() => {
    send({ type: "export-manifest" });
  }, [send]);

  useEffect(() => setPending(false), [latest]);

  const write = (overwrite: boolean) => {
    writePref(targetPref(workspace), target);
    setPending(true);
    send({ type: "export-write", target, overwrite });
  };

  return (
    <div className={styles.kit}>
      <p className={styles.kitIntro}>
        Everything a new project needs: the components with their CSS Modules, the tokens as CSS variables and as a
        Tailwind v4 theme, the source JSON, and a README on wiring it up. It needs React and a bundler with CSS Modules,
        nothing else.
      </p>
      {problems > 0 && (
        <p className={styles.kitWarning}>
          The workspace has {problems} open {problems === 1 ? "problem" : "problems"}. The kit exports as it is now.
        </p>
      )}
      <div className={styles.kitFiles}>
        {manifest ? (
          <>
            <span className={styles.muted}>
              {manifest.folder}/ · {manifest.files.length} files · {formatBytes(total)}
            </span>
            {/* It scrolls, so it takes focus: keyboard users can scroll it too. */}
            <ul tabIndex={0} aria-label="Files in the starter kit">
              {manifest.files.map((file) => (
                <li key={file.path}>
                  <span>{file.path}</span>
                  <span className={styles.muted}>{formatBytes(file.bytes)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <span className={styles.muted}>Collecting files…</span>
        )}
      </div>
      <form
        className={styles.kitWrite}
        onSubmit={(event) => {
          event.preventDefault();
          write(false);
        }}
      >
        <label htmlFor="export-target">Write into a project folder</label>
        <div className={styles.kitWriteRow}>
          <input
            id="export-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Browse, or paste the folder's path"
            spellCheck={false}
          />
          <BrowseButton
            title="Choose the folder to write the starter kit into"
            start={target}
            onPick={setTarget}
            onError={setBrowseError}
          />
          <button type="submit" className={styles.chromeButton} disabled={!target.trim() || pending}>
            {pending ? "Writing…" : "Write files"}
          </button>
        </div>
        {browseError && <p className={styles.kitError}>{browseError}</p>}
        {result?.error && <p className={styles.kitError}>{result.error}</p>}
        {conflicts && (
          <div className={styles.kitConflicts}>
            <p>
              {conflicts.conflicts.length} {conflicts.conflicts.length === 1 ? "file" : "files"} in{" "}
              <code>{conflicts.target}</code> would change. Nothing has been written yet.
            </p>
            <ul tabIndex={0} aria-label="Files that would change">
              {conflicts.conflicts.slice(0, 12).map((file) => (
                <li key={file}>{file}</li>
              ))}
              {conflicts.conflicts.length > 12 && <li>and {conflicts.conflicts.length - 12} more</li>}
            </ul>
            <button type="button" className={styles.chromeButton} onClick={() => write(true)} disabled={pending}>
              Overwrite these files
            </button>
          </div>
        )}
        {result?.ok && (
          <p className={styles.kitSuccess}>
            Wrote {result.written.length} files to <code>{result.target}</code>.
          </p>
        )}
      </form>
    </div>
  );
}

export function ExportDialog({
  design,
  projectId,
  workspace,
  problems,
  manifest,
  result,
  send,
  onClose,
  verify,
}: ExportDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("kit");
  // Here rather than in the tab, since the footer's Build .zip builds the chosen views too.
  const viewChoice = useViewChoice(workspace, verify.views);
  const [copied, setCopied] = useState(false);
  const format = FORMATS.find((item) => item.id === tab);
  const code = useMemo(() => format?.build(design) ?? "", [format, design]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => setCopied(false), [tab]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  const download = () => {
    if (!format) return;
    const url = URL.createObjectURL(new Blob([code], { type: format.type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = format.file;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
    >
      <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}>
          <div>
            <h2>Export {design.name}</h2>
            <p>
              The source of truth lives at <code>{workspace}</code>.
            </p>
          </div>
          <button type="button" className={styles.chromeButton} onClick={() => dialog.current?.close()}>
            Close
          </button>
        </header>
        <div className={styles.formatTabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "kit"} onClick={() => setTab("kit")}>
            Starter kit
          </button>
          <button type="button" role="tab" aria-selected={tab === "verify"} onClick={() => setTab("verify")}>
            Verification kit
          </button>
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tab}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "kit" ? (
          <StarterKit workspace={workspace} problems={problems} manifest={manifest} result={result} send={send} />
        ) : tab === "verify" ? (
          <VerifyKit workspace={workspace} send={send} choice={viewChoice} {...verify} />
        ) : (
          <pre className={styles.code}>{code}</pre>
        )}
        <footer className={styles.dialogFooter}>
          {tab === "verify" ? (
            <>
              <span className={styles.muted}>{viewChoice.request.folder}/ · takes a few seconds per screen</span>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={verify.progress !== null || !viewChoice.ready}
                onClick={() => send({ type: "verify-kit", ...viewChoice.request })}
              >
                {verify.progress ? "Building…" : "Build .zip"}
              </button>
            </>
          ) : tab === "kit" ? (
            <>
              <span className={styles.muted}>{manifest ? `${manifest.folder}.zip` : ""}</span>
              <a
                className={styles.primaryButton}
                href={`/export/starter-kit.zip${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`}
                download
              >
                Download .zip
              </a>
            </>
          ) : (
            <>
              <span className={styles.muted}>{format?.file}</span>
              <button type="button" className={styles.chromeButton} onClick={download}>
                Download
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
