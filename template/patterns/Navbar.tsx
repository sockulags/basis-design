import { useId, useState, type ReactNode } from "react";
import { Avatar } from "../components/index.ts";
import { Icon } from "./icons.tsx";
import styles from "./Navbar.module.css";

export interface NavbarLink {
  id: string;
  label: string;
  href?: string;
  /** Pins hover or focus, for the gallery. */
  force?: "hover" | "focus";
}

export interface NavbarProps {
  brand: ReactNode;
  links: NavbarLink[];
  active?: string;
  onNavigate?: (id: string) => void;
  /** Shows a search field with this placeholder. */
  searchPlaceholder?: string;
  /** Extra controls before the avatar, such as buttons. In the narrow layout they move into the menu. */
  actions?: ReactNode;
  user?: { initials: string; name: string };
  /** The bottom shadow used once the page has scrolled under the bar. */
  elevated?: boolean;
  /**
   * Forces the narrow layout, where links, search and actions move behind a menu button. Without it the bar switches by
   * itself when it is narrower than 960px.
   */
  compact?: boolean;
  /** Controls the menu from outside; otherwise the bar keeps its own open state. */
  menuOpen?: boolean;
  onMenuToggle?: () => void;
}

/** Top application bar: brand, primary links, search, actions and the signed-in user. */
export function Navbar({
  brand,
  links,
  active,
  onNavigate,
  searchPlaceholder,
  actions,
  user,
  elevated = false,
  compact = false,
  menuOpen,
  onMenuToggle,
}: NavbarProps) {
  const menuId = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = menuOpen ?? ownOpen;
  const toggle = onMenuToggle ?? (() => setOwnOpen((value) => !value));

  const search = searchPlaceholder && (
    <label className={styles.search}>
      <span className={styles.visuallyHidden}>Search</span>
      <Icon name="search" className={styles.searchIcon} />
      <input type="search" placeholder={searchPlaceholder} />
    </label>
  );

  const renderLink = (link: NavbarLink, className: string | undefined) => (
    <a
      key={link.id}
      href={link.href ?? "#"}
      className={className}
      aria-current={link.id === active ? "page" : undefined}
      data-force={link.force}
      onClick={(event) => {
        if (!onNavigate) return;
        event.preventDefault();
        onNavigate(link.id);
      }}
    >
      {link.label}
    </a>
  );

  return (
    <header
      className={styles.navbar}
      data-ds="navbar"
      data-elevated={elevated || undefined}
      data-compact={compact || undefined}
    >
      {/* Both layouts are rendered; the stylesheet shows the one that fits the bar's width. */}
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={toggle}
        >
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
        <div className={styles.brand}>{brand}</div>
        <nav className={styles.links} aria-label="Main">
          {links.map((link) => renderLink(link, styles.link))}
        </nav>
        <div className={styles.end}>
          {search}
          {actions && <div className={styles.actions}>{actions}</div>}
          {user && (
            <span className={styles.user} title={user.name}>
              <Avatar initials={user.initials} />
            </span>
          )}
        </div>
      </div>
      {open && (
        <div id={menuId} className={styles.menu}>
          {search}
          {actions && <div className={styles.actions}>{actions}</div>}
          <nav className={styles.menuLinks} aria-label="Main">
            {links.map((link) => renderLink(link, styles.menuLink))}
          </nav>
        </div>
      )}
    </header>
  );
}
