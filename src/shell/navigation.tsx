import type { ReactNode } from "react";
import { PAGES, type NavSection, type PageId } from "../../shared/frame.ts";

export interface NavItem {
  /** Section element id inside the preview. */
  id: string;
  label: string;
  icon: ReactNode;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavPage {
  id: PageId;
  label: string;
  groups: NavGroup[];
}

const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 16 16" aria-hidden>
    {paths}
  </svg>
);

/** Basis' own sections; always present. */
const FOUNDATIONS: NavGroup = {
  label: "Foundations",
  items: [
    {
      id: "color",
      label: "Color",
      icon: icon(
        <>
          <circle cx="6" cy="6.5" r="3.5" />
          <circle cx="10" cy="6.5" r="3.5" />
          <circle cx="8" cy="10" r="3.5" />
        </>,
      ),
    },
    { id: "typography", label: "Typography", icon: icon(<path d="M2.5 13 6 3.5 9.5 13M3.7 10h4.6M11 8.5h2.5M12.25 7v6" />) },
    { id: "shape", label: "Space & shape", icon: icon(<path d="M2.5 13.5V7a4.5 4.5 0 0 1 4.5-4.5h6.5" />) },
    { id: "motion", label: "Motion", icon: icon(<path d="M2 13.5c5 0 5-11 12-11" />) },
  ],
};

/** Icons for the starter sections; sections the agent adds get the generic one. */
const SECTION_ICONS: Record<string, ReactNode> = {
  buttons: icon(<rect x="1.75" y="4.75" width="12.5" height="6.5" rx="3.25" />),
  inputs: icon(
    <>
      <rect x="1.75" y="4.25" width="12.5" height="7.5" rx="1.5" />
      <path d="M5 6.5v3" />
    </>,
  ),
  selection: icon(
    <>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" />
      <path d="m5 8.25 2 2 4-4.5" />
    </>,
  ),
  feedback: icon(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.75v3.75M8 11v.01" />
    </>,
  ),
  navigation: icon(<path d="M1.5 12.5h13M3 12.5V5.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v2h4.5a1 1 0 0 1 1 1v4" />),
  surfaces: icon(
    <>
      <rect x="1.75" y="4.25" width="10" height="9" rx="1.5" />
      <path d="M4.5 2.25h8.25a1.5 1.5 0 0 1 1.5 1.5v6.75" />
    </>,
  ),
  overlays: icon(
    <>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" />
      <rect x="4.5" y="5" width="7" height="5.5" rx="1" />
    </>,
  ),
};

Object.assign(SECTION_ICONS, {
  navbar: icon(
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6h12.5" />
    </>,
  ),
  "sidebar-nav": icon(
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
    </>,
  ),
  "page-header": icon(<path d="M2.5 3.5h6M2.5 7h11M2.5 10h11M2.5 13h7" />),
  "data-table": icon(
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6.25h12.5M1.75 9.75h12.5M6 6.25v7" />
    </>,
  ),
  stats: icon(<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />),
  forms: icon(
    <>
      <rect x="2.25" y="2.75" width="11.5" height="3.5" rx="1" />
      <rect x="2.25" y="8.75" width="11.5" height="3.5" rx="1" />
    </>,
  ),
  "empty-states": icon(<path d="M2.5 9.5 4 3.5h8l1.5 6M2.5 9.5V13h11V9.5h-3.5a2 2 0 0 1-4 0Z" />),
  "app-shell": icon(
    <>
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" />
      <path d="M1.75 5.25h12.5M5.25 5.25v8.5" />
    </>,
  ),
});

const GENERIC_ICON = icon(
  <>
    <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
    <rect x="8.75" y="2.25" width="5" height="5" rx="1" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
    <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
  </>,
);

/**
 * Everything the sidebar can navigate to, per page: the foundations plus every
 * section the preview found in the workspace's specimen files, grouped as they
 * declare. Sections arrive in display order, so groups keep that order too.
 */
export function buildPages(sections: NavSection[]): NavPage[] {
  return PAGES.map((page) => {
    const groups = new Map<string, NavItem[]>();
    for (const section of sections.filter((item) => item.page === page.id)) {
      const items = groups.get(section.group) ?? [];
      items.push({ id: section.id, label: section.title, icon: SECTION_ICONS[section.id] ?? GENERIC_ICON });
      groups.set(section.group, items);
    }
    const found = [...groups].map(([label, items]) => ({ label, items }));
    return { id: page.id, label: page.label, groups: page.id === "system" ? [FOUNDATIONS, ...found] : found };
  });
}
