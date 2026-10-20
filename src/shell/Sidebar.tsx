import { pageById, type NavSection, type PageId } from "../../shared/frame.ts";
import type { MouseEvent } from "react";
import { buildPages } from "./navigation.tsx";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** The section shown alone, or the one at the top of the preview while the whole page shows. */
  active: string | undefined;
  /** The page shows as cards. */
  overview: boolean;
  /** The whole page shows on one page. */
  all: boolean;
  /** The address of a section alone (null: the page's cards), or of the whole page. */
  hrefFor: (id: string | null, all?: boolean) => string;
  onOverview: () => void;
  onAll: () => void;
  /** Sections of every page, reported by the preview. */
  sections: NavSection[];
  page: PageId;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Opens the dialog for a new component or pattern, depending on the page. */
  onCreate: () => void;
}

export function Sidebar({
  active,
  overview,
  all,
  hrefFor,
  onOverview,
  onAll,
  sections,
  page,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  onCreate,
}: SidebarProps) {
  /** A link the browser can open in a new tab, which the sidebar follows itself on a plain click. */
  const follow = (action: () => void) => (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    action();
  };
  const pages = buildPages(sections).filter((item) => item.id === page);
  const { kind } = pageById(page);
  return (
    <nav className={styles.sidebar} data-collapsed={collapsed || undefined} aria-label="Preview sections">
      <div className={styles.scroll}>
        {pages.map((page) => (
          <div key={page.id} className={styles.page}>
            <a
              href={hrefFor(null)}
              className={styles.pageLabel}
              aria-current={overview ? "page" : undefined}
              title={collapsed ? `${page.label}: overview` : undefined}
              onClick={follow(onOverview)}
            >
              {page.label}
            </a>
            {page.groups.map((group) => (
              <div key={group.label} className={styles.group}>
                <p className={styles.groupLabel}>{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={all ? `${hrefFor(null, true)}#${item.id}` : hrefFor(item.id)}
                        className={styles.item}
                        aria-current={active === item.id ? (all ? "location" : "page") : undefined}
                        title={collapsed ? item.label : undefined}
                        onClick={follow(() => onNavigate(item.id))}
                      >
                        {item.icon}
                        <span className={styles.label}>{item.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <a
              href={hrefFor(null, true)}
              className={`${styles.item} ${styles.allLink}`}
              aria-current={all ? "page" : undefined}
              title={collapsed ? "All on one page" : undefined}
              onClick={follow(onAll)}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6" />
              </svg>
              <span className={styles.label}>All on one page</span>
            </a>
          </div>
        ))}
        <button
          type="button"
          className={styles.create}
          onClick={onCreate}
          title={collapsed ? `New ${kind}` : undefined}
          aria-label={collapsed ? `New ${kind}` : undefined}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
          <span className={styles.label}>New {kind}</span>
        </button>
      </div>
      <button
        type="button"
        className={styles.collapse}
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          {collapsed ? <path d="m6.5 4.5 3.5 3.5-3.5 3.5" /> : <path d="M9.5 4.5 6 8l3.5 3.5" />}
        </svg>
        <span className={styles.label}>Collapse</span>
      </button>
    </nav>
  );
}
