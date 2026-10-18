import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDesignText } from "../shared/design.ts";
import { diffDesigns } from "../shared/diff.ts";
import type { HistoryEntry } from "../shared/protocol.ts";
import { git, lines } from "./exec.ts";
import { DESIGN_FILE, isSourcePath } from "./paths.ts";

/*
 * History is the workspace's git log: one commit per agent turn, approved
 * review, restore or hand edit, with Basis-* trailers carrying what the
 * history list shows (source, label, changed tokens, restore lineage).
 */

export type Source = HistoryEntry["source"];
export type EntryMeta = Pick<HistoryEntry, "label" | "restoredFrom">;

const HISTORY_LIMIT = 300;

export function describeSource(source: Source): string {
  if (source === "init") return "Starting point";
  if (source === "external") return "Edit on disk";
  if (source === "review") return "Approved review";
  if (source === "upgrade") return "Basis update";
  return "Earlier version";
}

function isSource(value: string | undefined): value is Source {
  return (
    value === "init" ||
    value === "agent" ||
    value === "revert" ||
    value === "external" ||
    value === "review" ||
    value === "upgrade"
  );
}

/**
 * Commits the working tree as a history entry if anything changed (or if the
 * repository has no commits yet). Returns whether a commit was made.
 */
export async function commitToHistory(
  dir: string,
  source: Source,
  meta: EntryMeta,
  designName: string,
): Promise<boolean> {
  await git(dir, ["add", "-A"]);
  const staged = lines(await git(dir, ["diff", "--cached", "--name-only"]));
  const isFirst = (await git(dir, ["rev-list", "-n", "1", "--all"]).catch(() => "")).trim() === "";
  if (staged.length === 0 && !isFirst) return false;
  let changed: string[] = [];
  if (!isFirst && staged.includes(DESIGN_FILE)) {
    const before = parseDesignText(await git(dir, ["show", `HEAD:${DESIGN_FILE}`]).catch(() => ""));
    const after = parseDesignText(await readFile(path.join(dir, DESIGN_FILE), "utf8").catch(() => ""));
    if (before.ok && after.ok) changed = diffDesigns(before.design, after.design).map((change) => change.path);
  }
  const label = meta.label?.replace(/\s+/g, " ").trim();
  const message = [
    label ? `${source}: ${label.slice(0, 72)}` : source,
    "",
    `Basis-Source: ${source}`,
    `Basis-Name: ${designName}`,
    label ? `Basis-Label: ${label}` : "",
    meta.restoredFrom ? `Basis-Restored-From: ${meta.restoredFrom}` : "",
    changed.length ? `Basis-Changed: ${changed.join(",")}` : "",
  ]
    .filter((line, index) => index < 2 || line)
    .join("\n");
  await git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return true;
}

/** The latest entries of the workspace's history (the current branch), oldest first. */
export async function loadHistory(dir: string): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await git(dir, ["log", `-n${HISTORY_LIMIT}`, "--name-only", "--format=%x1e%H%x1f%ct%x1f%B%x1f"]);
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const record of raw.split("\x1e").slice(1)) {
    const [id = "", time = "0", body = "", names = ""] = record.split("\x1f");
    const trailers = new Map<string, string>();
    for (const line of body.split("\n")) {
      const match = /^Basis-([A-Za-z-]+): (.*)$/.exec(line.trim());
      if (match?.[1] && match[2] !== undefined) trailers.set(match[1], match[2]);
    }
    const source = trailers.get("Source");
    entries.push({
      id,
      at: Number(time) * 1000,
      source: isSource(source) ? source : "external",
      name: trailers.get("Name") ?? "",
      label: trailers.get("Label"),
      restoredFrom: trailers.get("Restored-From"),
      changed: trailers.get("Changed")?.split(",").filter(Boolean) ?? [],
      files: names
        .split("\n")
        .map((name) => name.trim())
        .filter(isSourcePath),
    });
  }
  return entries.reverse();
}
