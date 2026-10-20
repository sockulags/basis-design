import type { ReactNode } from "react";
import { PAGES, type PageId } from "../../shared/frame.ts";
import styles from "./Shell.module.css";

type Theme = "light" | "dark";

interface TopBarProps {
  page: PageId;
  onPage: (page: PageId) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  /** The project menu, in the brand's place. */
  project: ReactNode;
  /** The history menu, which owns its own state. */
  history: ReactNode;
  onExport: () => void;
  canExport: boolean;
}

/** The bar above the preview: project, pages, preview theme, history and export. */
export function TopBar({ page, onPage, theme, onTheme, project, history, onExport, canExport }: TopBarProps) {
  return (
    <header className={styles.bar}>
      {project}
      <nav className={styles.pages} aria-label="Pages">
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => onPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={styles.actions}>
        <div className={styles.themeToggle} role="group" aria-label="Preview theme">
          {(["light", "dark"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => onTheme(value)}>
              {value === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        {history}
        <button type="button" className={styles.chromeButton} onClick={onExport} disabled={!canExport}>
          Export
        </button>
      </div>
    </header>
  );
}
