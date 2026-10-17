import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_IDS, type AgentId, type ChatItem } from "../shared/protocol.ts";

/*
 * The conversation, kept in .basis/chat.json so a restart does not lose it:
 * the transcript, and the agent session it belongs to, so the agent can pick
 * the conversation up again where it supports that.
 */

export interface SavedChat {
  agent: AgentId;
  sessionId: string | null;
  chat: ChatItem[];
}

const FILE = "chat.json";
const MAX_ITEMS = 500;

const file = (dir: string) => path.join(dir, ".basis", FILE);

export async function loadChat(dir: string): Promise<SavedChat | null> {
  try {
    const raw = JSON.parse(await readFile(file(dir), "utf8")) as Partial<SavedChat>;
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

/**
 * Writes the conversation. Image data is left out (it can be megabytes and the
 * agent already has it); queued messages are not, since the queue itself does
 * not survive a restart and they would never run.
 */
export async function saveChat(dir: string, saved: SavedChat): Promise<void> {
  const chat = saved.chat
    .filter((item) => !(item.kind === "user" && item.queued))
    .slice(-MAX_ITEMS)
    .map((item) => (item.kind === "user" && item.images ? { ...item, images: undefined } : item));
  await writeFile(file(dir), JSON.stringify({ ...saved, chat }));
}

/** What a saved item means after a restart: nothing is still running or waiting for an answer. */
function settle(item: ChatItem): ChatItem {
  if (item.kind === "permission" && !item.resolved) return { ...item, resolved: "Interrupted by a restart" };
  if (item.kind === "tool" && (item.status === "pending" || item.status === "in_progress"))
    return { ...item, status: "failed" };
  return item;
}
