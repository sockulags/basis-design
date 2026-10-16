import type { NavSection } from "../../shared/frame.ts";
import { buildPages } from "./navigation.tsx";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Section currently at the top of the preview, reported by the preview frame. */
  active: string | undefined;
  /** Component sections reported by the preview. */
  sections: NavSection[];
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ active, sections, onNavigate, collapsed, onToggleCollapsed }: SidebarProps) {
  const pages = buildPages(sections);
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
