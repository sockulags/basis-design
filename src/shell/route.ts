import { isPageId, type PageId } from "../../shared/frame.ts";

/**
 * Where the chrome is, as an address: /p/<project>/<page> is a page's overview, /p/<project>/<page>/<section> one
 * section alone, and ?all the whole page on one page. Each address can be bookmarked, shared and reached with the
 * browser's back and forward.
 */
export interface Route {
  project: string | null;
  page: PageId | null;
  focus: string | null;
  all: boolean;
}

const SECTION = /^[a-z0-9-]{1,80}$/;

export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const route: Route = { project: null, page: null, focus: null, all: new URLSearchParams(search).has("all") };
  if (parts[0] !== "p" || !parts[1]) return route;
  try {
    route.project = decodeURIComponent(parts[1]);
  } catch {
    return route;
  }
  if (isPageId(parts[2])) route.page = parts[2];
  if (route.page && parts[3] && SECTION.test(parts[3])) route.focus = parts[3];
  return route;
}

export function formatRoute(route: { project: string; page: PageId; focus: string | null; all: boolean }): string {
  const base = `/p/${encodeURIComponent(route.project)}/${route.page}`;
  if (route.focus) return `${base}/${route.focus}`;
  return route.all ? `${base}?all` : base;
}
