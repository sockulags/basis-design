import { pageById, type NavSection, type PageId } from "../../shared/frame.ts";
import { buildPages } from "./navigation.tsx";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Section currently at the top of the preview, reported by the preview frame. */
  active: string | undefined;
  /** Sections of every page, reported by the preview. */
  sections: NavSection[];
  page: PageId;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Opens the dialog for a new component or pattern, depending on the page. */
  onCreate: () => void;
}

export function Sidebar({ active, sections, page, onNavigate, collapsed, onToggleCollapsed, onCreate }: SidebarProps) {
  const pages = buildPages(sections).filter((item) => item.id === page);
  const { kind } = pageById(page);
  return (
    <nav className={styles.sidebar} data-collapsed={collapsed || undefined} aria-label="Preview sections">
      <div className={styles.scroll}>
        {pages.map((page) => (
          <div key={page.id} className={styles.page}>
            <p className={styles.pageLabel}>{page.label}</p>
            {page.groups.map((group) => (
              <div key={group.label} className={styles.group}>
                <p className={styles.groupLabel}>{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={styles.item}
                        aria-current={active === item.id ? "location" : undefined}
                        title={collapsed ? item.label : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(item.id);
                        }}
                      >
                        {item.icon}
                        <span className={styles.label}>{item.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
