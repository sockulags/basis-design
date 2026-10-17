/**
 * Render problems as reported by each open Basis tab. Every tab runs its own
 * preview, and a tab left open from earlier can run outdated code, so the fix
 * loop listens to one of them: the tab the user looks at, or else the one they
 * looked at last. A single tab always counts, hidden or not, so the loop keeps
 * working while the user waits in another window.
 */
export class PreviewReports<Connection> {
  private reports = new Map<Connection, Report>();
  private clock = 0;

  /** Records what a tab's preview shows now (render errors and check findings), and whether the tab is visible. */
  report(connection: Connection, errors: string[], visible: boolean, checks: string[] = [], checking = false): void {
    const previous = this.reports.get(connection);
    const tick = ++this.clock;
    this.reports.set(connection, {
      errors,
      checks,
      checking,
      visible,
      // Becoming visible makes a tab the current one; staying visible keeps the moment it became so.
      visibleSince: visible ? (previous?.visible ? previous.visibleSince : tick) : 0,
      lastSeen: visible ? tick : (previous?.lastSeen ?? 0),
      reportedAt: tick,
    });
  }

  forget(connection: Connection): void {
    this.reports.delete(connection);
  }

  /** The problems of the current tab: visible and most recently shown, else most recently seen, else latest. */
  get current(): string[] {
    return this.best()?.errors ?? [];
  }

  /** The check findings of the same tab. */
  get checks(): string[] {
    return this.best()?.checks ?? [];
  }

  /** Whether that tab is still running a check. */
  get checking(): boolean {
    return this.best()?.checking ?? false;
  }

  private best(): Report | undefined {
    let best: Report | undefined;
    for (const report of this.reports.values()) if (!best || rank(report, best) > 0) best = report;
    return best;
  }
}

interface Report {
  errors: string[];
  checks: string[];
  checking: boolean;
  visible: boolean;
  /** When the tab last became visible (a counter, 0 while hidden). */
  visibleSince: number;
  /** When the tab was last reported visible. */
  lastSeen: number;
  reportedAt: number;
}

/** Positive when `a` is the better source than `b`. */
function rank(a: Report, b: Report): number {
  if (a.visible !== b.visible) return a.visible ? 1 : -1;
  if (a.visible) return a.visibleSince - b.visibleSince;
  return a.lastSeen - b.lastSeen || a.reportedAt - b.reportedAt;
}
