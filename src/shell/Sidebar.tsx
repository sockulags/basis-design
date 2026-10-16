import { useEffect, useState, type RefObject } from "react";
import { PAGES } from "./navigation.tsx";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** The scrolling preview the sections live in. */
  container: RefObject<HTMLElement | null>;
  /** Becomes true once the preview content has rendered, so the scroll spy can measure it. */
  ready: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ALL_IDS = PAGES.flatMap((page) => page.groups.flatMap((group) => group.items.map((item) => item.id)));
/** A section counts as current once its top passes this far below the top of the preview. */
const SPY_OFFSET = 120;

/** Tracks which section is at the top of the scroll container. */
function useActiveSection(container: RefObject<HTMLElement | null>, ready: boolean): string | undefined {
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const root = container.current;
    if (!root || !ready) return;
    let raf = 0;
    const measure = () => {
      const top = root.getBoundingClientRect().top + SPY_OFFSET;
      let current: string | undefined = ALL_IDS[0];
      for (const id of ALL_IDS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= top) current = id;
      }
      // At the very bottom the last short sections can never reach the top, so pick the last one.
      const scrollable = root.scrollHeight > root.clientHeight + 2;
      if (scrollable && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = ALL_IDS.at(-1);
      setActive(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [container, ready]);

  return active;
}

export function Sidebar({ container, ready, collapsed, onToggleCollapsed }: SidebarProps) {
  const active = useActiveSection(container, ready);

  const go = (id: string) => {
    const section = document.getElementById(id);
    if (!section) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav className={styles.sidebar} data-collapsed={collapsed || undefined} aria-label="Preview sections">
      <div className={styles.scroll}>
        {PAGES.map((page) => (
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
                          go(item.id);
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
