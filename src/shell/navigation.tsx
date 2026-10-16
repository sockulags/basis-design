import type { ReactNode } from "react";
import type { NavSection } from "../../shared/frame.ts";

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
  id: string;
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

const GENERIC_ICON = icon(
  <>
    <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
    <rect x="8.75" y="2.25" width="5" height="5" rx="1" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
    <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
  </>,
);

/**
 * Everything the sidebar can navigate to: the foundations plus every section
 * the preview found in the workspace's specimen files, grouped as they declare.
 * Further pages slot in here as more NavPage entries.
 */
export function buildPages(sections: NavSection[]): NavPage[] {
  const groups = new Map<string, NavItem[]>();
  for (const section of sections) {
    const items = groups.get(section.group) ?? [];
    items.push({ id: section.id, label: section.title, icon: SECTION_ICONS[section.id] ?? GENERIC_ICON });
    groups.set(section.group, items);
  }
  return [
    {
      id: "system",
      label: "Design system",
      groups: [FOUNDATIONS, ...[...groups].map(([label, items]) => ({ label, items }))],
    },
  ];
}
