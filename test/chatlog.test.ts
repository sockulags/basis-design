import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadChat, saveChat } from "../server/chatlog.ts";
import type { ChatItem } from "../shared/protocol.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "basis-chat-"));
  dirs.push(dir);
  await mkdir(path.join(dir, ".basis"));
  return dir;
}

test("the chat survives a save and load, without image data or queued messages", async () => {
  const dir = await workspace();
  const chat: ChatItem[] = [
    { kind: "user", id: "u1", text: "Softer buttons", images: ["data:image/png;base64,AAAA"] },
    { kind: "agent", id: "a1", text: "Done." },
    { kind: "user", id: "u2", text: "And the tabs", queued: true },
  ];
  await saveChat(dir, { agent: "claude", sessionId: "session-1", chat });
  assert.doesNotMatch(await readFile(path.join(dir, ".basis", "chat.json"), "utf8"), /base64/);
  assert.deepEqual(await loadChat(dir), {
    agent: "claude",
    sessionId: "session-1",
    chat: [
      { kind: "user", id: "u1", text: "Softer buttons" },
      { kind: "agent", id: "a1", text: "Done." },
    ],
  });
});

test("nothing is left running or waiting after a restart", async () => {
  const dir = await workspace();
  await saveChat(dir, {
    agent: "claude",
    sessionId: null,
    chat: [
      { kind: "tool", id: "t1", title: "Edit Button.tsx", toolKind: "edit", status: "in_progress" },
      { kind: "permission", id: "p1", title: "Run a command", options: [] },
    ],
  });
  const saved = await loadChat(dir);
  assert.equal(saved?.chat[0]?.kind === "tool" && saved.chat[0].status, "failed");
  assert.equal(saved?.chat[1]?.kind === "permission" && saved.chat[1].resolved, "Interrupted by a restart");
});

test("a missing or damaged file means no saved chat", async () => {
  const dir = await workspace();
  assert.equal(await loadChat(dir), null);
});
