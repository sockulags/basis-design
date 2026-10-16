import { useEffect, useMemo, useRef, useState } from "react";
import type { Design } from "../../shared/design.ts";
import { exportCss, exportJson, exportTailwind } from "../../shared/tokens.ts";
import styles from "./Shell.module.css";

const FORMATS = [
  { id: "css", label: "CSS variables", file: "tokens.css", type: "text/css", build: exportCss },
  { id: "tailwind", label: "Tailwind v4", file: "theme.css", type: "text/css", build: exportTailwind },
  { id: "json", label: "JSON", file: "design-system.json", type: "application/json", build: exportJson },
] as const;

export function ExportDialog({ design, workspace, onClose }: { design: Design; workspace: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("css");
  const [copied, setCopied] = useState(false);
  const active = FORMATS.find((item) => item.id === format) ?? FORMATS[0];
  const code = useMemo(() => active.build(design), [active, design]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => setCopied(false), [format]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: active.type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = active.file;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} onClick={(event) => event.target === dialog.current && dialog.current?.close()}>
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
          {FORMATS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === format} onClick={() => setFormat(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <pre className={styles.code}>{code}</pre>
        <footer className={styles.dialogFooter}>
          <span className={styles.muted}>{active.file}</span>
          <button type="button" className={styles.chromeButton} onClick={download}>
            Download
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
