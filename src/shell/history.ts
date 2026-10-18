import type { HistoryEntry } from "../../shared/protocol.ts";

export const SOURCE_LABEL: Record<HistoryEntry["source"], string> = {
  init: "Starting point",
  agent: "Agent change",
  revert: "Restored",
  external: "Edited on disk",
  review: "Approved review",
  upgrade: "Basis update",
};

/**
 * Basis bringing the workspace up to date. Earlier versions recorded that as an edit on disk labelled
 * "Basis added …".
 */
function isUpgrade(entry: HistoryEntry): boolean {
  return entry.source === "upgrade" || (entry.source === "external" && !!entry.label?.startsWith("Basis added"));
}

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function when(at: number): string {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? time.format(date)
    : `${day.format(date)} ${time.format(date)}`;
}

/**
 * The entry whose design is current, looking through restores: after
 * restoring X, the effective step is X itself.
 */
export function effectiveEntry(history: HistoryEntry[]): HistoryEntry | undefined {
  const byId = new Map(history.map((entry) => [entry.id, entry]));
  let current = history.at(-1);
  const seen = new Set<string>();
  while (current?.source === "revert" && current.restoredFrom && !seen.has(current.id)) {
    seen.add(current.id);
    const origin = byId.get(current.restoredFrom);
    if (!origin) break;
    current = origin;
  }
  return current;
}

/**
 * What Undo goes back to, and the step it undoes. Repeated undos walk back instead of toggling. They stop at a Basis
 * update: undoing it would remove files the workspace now needs (History can still restore an earlier version).
 */
export function undoStep(history: HistoryEntry[]): { undoes: HistoryEntry; target: HistoryEntry } | null {
  const undoes = effectiveEntry(history);
  if (!undoes || isUpgrade(undoes)) return null;
  const target = history[history.indexOf(undoes) - 1];
  return target ? { undoes, target } : null;
}

/** "3 tokens · 2 files changed", or "No changes". */
export function describeChanges(entry: HistoryEntry): string {
  const parts: string[] = [];
  if (entry.changed.length) parts.push(`${entry.changed.length} ${entry.changed.length === 1 ? "token" : "tokens"}`);
  if (entry.files.length) parts.push(`${entry.files.length} ${entry.files.length === 1 ? "file" : "files"}`);
  return parts.length ? `${parts.join(" · ")} changed` : "No changes";
}
