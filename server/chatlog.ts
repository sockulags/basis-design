import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_IDS, type AgentId, type ChatItem } from "../shared/protocol.ts";

/*
 * The conversations, kept in .basis so a restart does not lose them. A project has threads, each a chat of its own:
 * .basis/threads.json lists them (newest first) and names the one shown last, and .basis/threads/<id>.json holds
 * each one's transcript and the agent session it belongs to, so the agent can pick the conversation up again where
 * it supports that. Before threads there was one conversation, in .basis/chat.json; it becomes the first thread and
 * the file is left where it is.
 */

export interface SavedChat {
  agent: AgentId;
  sessionId: string | null;
  chat: ChatItem[];
}

/** A thread as the list keeps it. */
export interface SavedThread {
  id: string;
  title: string;
  at: number;
}

export interface SavedThreads {
  /** The thread shown last, which a new tab shows. */
  active: string;
  /** Newest first, each with its conversation (null when its file is missing or damaged). */
  threads: (SavedThread & { saved: SavedChat | null })[];
}

const LEGACY_FILE = "chat.json";
const INDEX_FILE = "threads.json";
const THREADS_DIR = "threads";
const MAX_ITEMS = 500;
/** The title of a thread nothing has been asked in yet. */
export const UNTITLED = "New chat";
const TITLE_LENGTH = 60;

const basis = (dir: string, ...parts: string[]) => path.join(dir, ".basis", ...parts);
/** Thread ids name files, so they are only ever Basis' own (newThreadId). */
const isThreadId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id);
const threadFile = (dir: string, id: string) => basis(dir, THREADS_DIR, `${id}.json`);

export function newThreadId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A thread's title from what was asked in it: the first line, cut at a word. */
export function threadTitle(text: string): string {
  const line = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (line.length <= TITLE_LENGTH) return line || UNTITLED;
  const cut = line.slice(0, TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

async function readChat(file: string): Promise<SavedChat | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<SavedChat>;
    if (!AGENT_IDS.includes(raw.agent as AgentId) || !Array.isArray(raw.chat)) return null;
    return {
      agent: raw.agent as AgentId,
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
      chat: raw.chat
        .filter((item): item is ChatItem => Boolean(item && typeof item === "object" && "kind" in item && "id" in item))
        .map(settle),
    };
  } catch {
    return null;
  }
}

/** The single conversation of a workspace from before threads (.basis/chat.json). */
export function loadChat(dir: string): Promise<SavedChat | null> {
  return readChat(basis(dir, LEGACY_FILE));
}

/**
 * The workspace's threads. A workspace without a list gets one from its old chat.json (as the first thread, titled
 * by its first prompt) or none, and the list is written at once, so the next start finds it.
 */
export async function loadThreads(dir: string): Promise<SavedThreads> {
  try {
    const raw = JSON.parse(await readFile(basis(dir, INDEX_FILE), "utf8")) as { active?: unknown; threads?: unknown };
    if (!Array.isArray(raw.threads)) throw new Error("no list");
    const threads: SavedThreads["threads"] = [];
    for (const entry of raw.threads as Partial<SavedThread>[]) {
      if (!isThreadId(entry?.id) || threads.some((thread) => thread.id === entry.id)) continue;
      threads.push({
        id: entry.id,
        title: typeof entry.title === "string" && entry.title.trim() ? entry.title : UNTITLED,
        at: Number(entry.at) || 0,
        saved: await readChat(threadFile(dir, entry.id)),
      });
    }
    const active = threads.find((thread) => thread.id === raw.active)?.id ?? threads[0]?.id ?? "";
    return { active, threads };
  } catch {
    // No list yet (or a damaged one): the conversation from before threads, if any, is the first thread.
  }
  const legacy = await loadChat(dir);
  if (!legacy) return { active: "", threads: [] };
  const first = legacy.chat.find((item) => item.kind === "user" && !item.auto && item.text);
  const at = await stat(basis(dir, LEGACY_FILE)).then(
    (info) => info.mtimeMs,
    () => Date.now(),
  );
  const thread = {
    id: newThreadId(),
    title: first?.kind === "user" ? threadTitle(first.text) : UNTITLED,
    at: Math.round(at),
  };
  await saveThread(dir, thread.id, legacy);
  await saveThreadList(dir, { active: thread.id, threads: [thread] });
  return { active: thread.id, threads: [{ ...thread, saved: legacy }] };
}

/** Writes the list of threads (newest first) and which one was shown last. */
export async function saveThreadList(dir: string, list: { active: string; threads: SavedThread[] }): Promise<void> {
  const threads = list.threads.map(({ id, title, at }) => ({ id, title, at }));
  await writeFile(basis(dir, INDEX_FILE), JSON.stringify({ active: list.active, threads }));
}

/**
 * Writes one thread's conversation. Image data is left out (it can be megabytes and the agent already has it);
 * queued messages are too, since the queue itself does not survive a restart and they would never run.
 */
export async function saveThread(dir: string, id: string, saved: SavedChat): Promise<void> {
  if (!isThreadId(id)) throw new Error(`Not a thread id: ${id}`);
  const chat = saved.chat
    .filter((item) => !(item.kind === "user" && item.queued))
    .slice(-MAX_ITEMS)
    .map((item) => (item.kind === "user" && item.images ? { ...item, images: undefined } : item));
  await mkdir(basis(dir, THREADS_DIR), { recursive: true });
  await writeFile(threadFile(dir, id), JSON.stringify({ ...saved, chat }));
}

/** Deletes a removed thread's conversation. */
export async function removeThreadFile(dir: string, id: string): Promise<void> {
  if (isThreadId(id)) await rm(threadFile(dir, id), { force: true });
}

/** What a saved item means after a restart: nothing is still running or waiting for an answer. */
function settle(item: ChatItem): ChatItem {
  if (item.kind === "permission" && !item.resolved) return { ...item, resolved: "Interrupted by a restart" };
  if (item.kind === "tool" && (item.status === "pending" || item.status === "in_progress"))
    return { ...item, status: "failed" };
  return item;
}
