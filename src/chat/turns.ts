import type { ChatItem } from "../../shared/protocol.ts";

/*
 * The conversation as people read it: what they asked, what the agent answered, and, folded between the two, the
 * work it did. The agent's turn is mostly machinery (reading files, searching, running commands, thinking aloud)
 * that matters only when something goes wrong, so each turn's machinery becomes one block that says what it
 * amounted to, and the answer stands on its own.
 */

/** One line of a turn's work: a tool call (merged with the same call right before it), a thought, a remark. */
export type WorkStep =
  | { type: "tool"; id: string; label: string; detail: string; kind: string; status: string; count: number }
  | { type: "thought"; id: string; text: string }
  | { type: "note"; id: string; text: string }
  | { type: "allowed"; id: string; title: string; resolved: string };

export interface WorkSummary {
  read: number;
  edited: number;
  searched: number;
  ran: number;
  screenshots: number;
  other: number;
  failed: number;
}

export type ChatBlock =
  | { type: "item"; item: ChatItem }
  | { type: "work"; id: string; steps: WorkStep[]; summary: WorkSummary; live: boolean; current: WorkStep | null };

/** A path as people read it: forward slashes, and nothing above the workspace or a home folder. */
export function shortPath(text: string): string {
  return text
    .replace(/\\/g, "/")
    .replace(/[A-Za-z]:\/Users\/[^/\s"']+\/\.basis\/workspaces\/[^/\s"']+\//g, "")
    .replace(/\/(?:Users|home)\/[^/\s"']+\/\.basis\/workspaces\/[^/\s"']+\//g, "")
    .replace(/[A-Za-z]:\/Users\/[^/\s"']+\//g, "~/")
    .replace(/\/(?:Users|home)\/[^/\s"']+\//g, "~/");
}

/** The programs a shell command line runs, in order, without `cd`: "grep, sed, sort". */
export function commandPrograms(command: string): string[] {
  const programs: string[] = [];
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const words = part.trim().split(/\s+/);
    // Leading assignments (NAME=value) and the shell's keywords (do, then …) are not the program.
    const word = words.find((item) => !/^[A-Za-z_]\w*=/.test(item) && !/^(do|then|else|time|!)$/.test(item));
    const program = word
      ?.replace(/^["']|["']$/g, "")
      .split(/[\\/]/)
      .pop();
    if (!program || program === "cd" || /^(for|done|fi|if|while|until|case|esac)$/.test(program)) continue;
    if (!/^[\w.+-]+$/.test(program)) continue;
    if (!programs.includes(program)) programs.push(program);
  }
  return programs;
}

/** A tool call's line: what it did in a few words, and the call as it was for those who open it. */
export function describeTool(title: string, kind: string): { label: string; detail: string } {
  const detail = shortPath(title);
  if (kind === "execute") {
    const programs = commandPrograms(title);
    return {
      label: programs.length
        ? `Ran ${programs.slice(0, 4).join(", ")}${programs.length > 4 ? " …" : ""}`
        : "Ran a command",
      detail,
    };
  }
  return { label: detail.length > 90 ? `${detail.slice(0, 87)}…` : detail, detail };
}

function emptySummary(): WorkSummary {
  return { read: 0, edited: 0, searched: 0, ran: 0, screenshots: 0, other: 0, failed: 0 };
}

function count(summary: WorkSummary, step: Extract<WorkStep, { type: "tool" }>): void {
  if (step.status === "failed") summary.failed += step.count;
  if (/^screenshot/i.test(step.label)) summary.screenshots += step.count;
  else if (step.kind === "read") summary.read += step.count;
  else if (step.kind === "edit" || step.kind === "delete" || step.kind === "move") summary.edited += step.count;
  else if (step.kind === "search" || step.kind === "fetch") summary.searched += step.count;
  else if (step.kind === "execute") summary.ran += step.count;
  else summary.other += step.count;
}

/** The summary as a line, what changed first: "Edited 3 files · 2 screenshots · 4 commands · read 12 files". */
export function describeSummary(summary: WorkSummary): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    summary.edited && `edited ${plural(summary.edited, "file")}`,
    summary.screenshots && plural(summary.screenshots, "screenshot"),
    summary.ran && plural(summary.ran, "command"),
    summary.searched && plural(summary.searched, "search", "searches"),
    summary.read && `read ${plural(summary.read, "file")}`,
    summary.other && plural(summary.other, "other step"),
  ].filter(Boolean) as string[];
  const text = parts.join(" · ") || "Worked";
  return `${text[0]!.toUpperCase()}${text.slice(1)}${summary.failed ? ` · ${summary.failed} failed` : ""}`;
}

/**
 * The chat as blocks. A turn's tools, thoughts, answered permission requests and the agent's remarks between them
 * become one work block; what the agent says after its last step is its answer and stays an item. While the last
 * turn runs (`running`), its work block is live and names the step in progress. Questions waiting for an answer,
 * plans and notices stay where they are, outside the work.
 */
export function groupChat(chat: ChatItem[], running: boolean): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let turn: ChatItem[] = [];
  const flush = (last: boolean) => {
    if (!turn.length) return;
    // The answer: the agent's text after the turn's last piece of work.
    let end = turn.length;
    while (end > 0 && turn[end - 1]!.kind === "agent") end--;
    const live = last && running;
    const work = turn.slice(0, end);
    const after = turn.slice(end);
    const steps: WorkStep[] = [];
    const kept: ChatItem[] = [];
    const summary = emptySummary();
    for (const item of work) {
      if (item.kind === "tool") {
        const { label, detail } = describeTool(item.title, item.toolKind);
        const previous = steps.at(-1);
        if (previous?.type === "tool" && previous.detail === detail && previous.status === item.status)
          previous.count++;
        else
          steps.push({ type: "tool", id: item.id, label, detail, kind: item.toolKind, status: item.status, count: 1 });
      } else if (item.kind === "thought") steps.push({ type: "thought", id: item.id, text: item.text });
      else if (item.kind === "agent") steps.push({ type: "note", id: item.id, text: item.text });
      else if (item.kind === "permission" && item.resolved)
        steps.push({ type: "allowed", id: item.id, title: shortPath(item.title), resolved: item.resolved });
      else kept.push(item);
    }
    for (const step of steps) if (step.type === "tool") count(summary, step);
    if (steps.length) {
      const current = live ? ([...steps].reverse().find((step) => step.type === "tool") ?? steps.at(-1) ?? null) : null;
      blocks.push({
        type: "work",
        id: `work-${steps[0]!.id}`,
        steps,
        summary,
        live: live && after.length === 0,
        current,
      });
    }
    for (const item of kept) blocks.push({ type: "item", item });
    for (const item of after) blocks.push({ type: "item", item });
    turn = [];
  };
  for (const item of chat) {
    if (item.kind === "user") {
      flush(false);
      blocks.push({ type: "item", item });
    } else turn.push(item);
  }
  flush(true);
  return blocks;
}
