import type { ReactNode } from "react";
import { PAGES, type PageId } from "../../shared/frame.ts";
import styles from "./Shell.module.css";

type Theme = "light" | "dark";

interface TopBarProps {
  chatHidden: boolean;
  onToggleChat: () => void;
  /** Shows a dot on the chat toggle while the chat is hidden and the agent works. */
  agentBusy: boolean;
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

/** The bar above the preview: chat toggle, project, pages, preview theme, history and export. */
export function TopBar({
  chatHidden,
  onToggleChat,
  agentBusy,
  page,
  onPage,
  theme,
  onTheme,
  project,
  history,
  onExport,
  canExport,
}: TopBarProps) {
  return (
    <header className={styles.bar}>
      <button
        type="button"
        className={styles.chatToggle}
        aria-pressed={!chatHidden}
        aria-label={chatHidden ? "Show chat" : "Hide chat"}
        title={`${chatHidden ? "Show" : "Hide"} chat (Ctrl+B)`}
        onClick={onToggleChat}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M6 3v10" />
          {chatHidden ? <path d="M9 6.5 10.5 8 9 9.5" /> : <path d="M10.5 6.5 9 8l1.5 1.5" />}
        </svg>
        {chatHidden && agentBusy && <span className={styles.chatToggleDot} aria-label="Agent is working" />}
      </button>
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
