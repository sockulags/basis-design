import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  loadThreads,
  newThreadId,
  removeThreadFile,
  saveThread,
  saveThreadList,
  threadTitle,
  UNTITLED,
} from "../server/chatlog.ts";
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

test("each thread's chat survives a save and load, without image data or queued messages", async () => {
  const dir = await workspace();
  const chat: ChatItem[] = [
    { kind: "user", id: "u1", text: "Softer buttons", images: ["data:image/png;base64,AAAA"] },
    { kind: "agent", id: "a1", text: "Done." },
    { kind: "user", id: "u2", text: "And the tabs", queued: true },
  ];
  const first = newThreadId();
  const second = newThreadId();
  await saveThread(dir, first, { agent: "claude", sessionId: "session-1", chat });
  await saveThread(dir, second, { agent: "codex", sessionId: null, chat: [{ kind: "agent", id: "a2", text: "Hi" }] });
  await saveThreadList(dir, {
    active: first,
    threads: [
      { id: second, title: "Tabs", at: 2 },
      { id: first, title: "Softer buttons", at: 1 },
    ],
  });
  assert.doesNotMatch(await readFile(path.join(dir, ".basis", "threads", `${first}.json`), "utf8"), /base64/);
  assert.deepEqual(await loadThreads(dir), {
    active: first,
    threads: [
      {
        id: second,
        title: "Tabs",
        at: 2,
        saved: { agent: "codex", sessionId: null, chat: [{ kind: "agent", id: "a2", text: "Hi" }] },
      },
      {
        id: first,
        title: "Softer buttons",
        at: 1,
        saved: {
          agent: "claude",
          sessionId: "session-1",
          chat: [
            { kind: "user", id: "u1", text: "Softer buttons" },
            { kind: "agent", id: "a1", text: "Done." },
          ],
        },
      },
    ],
  });
});

test("the conversation from before threads becomes the first thread, and its file stays", async () => {
  const dir = await workspace();
  const legacy = path.join(dir, ".basis", "chat.json");
  const chat = [
    { kind: "user", id: "u0", text: "Your last change left problems", auto: true },
    { kind: "user", id: "u1", text: "Make the buttons softer\nand rounder" },
  ];
  await writeFile(legacy, JSON.stringify({ agent: "claude", sessionId: "old-session", chat }));
  const loaded = await loadThreads(dir);
  assert.equal(loaded.threads.length, 1);
  const [thread] = loaded.threads;
  assert.equal(loaded.active, thread?.id);
  assert.equal(thread?.title, "Make the buttons softer");
  assert.equal(thread?.saved?.sessionId, "old-session");
  assert.equal(thread?.saved?.chat.length, 2);
  assert.ok(existsSync(legacy), "chat.json is left where it was");
  // The list was written, so the next start reads the thread rather than making another from chat.json.
  assert.deepEqual((await loadThreads(dir)).threads, loaded.threads);
});

test("nothing is left running or waiting after a restart", async () => {
  const dir = await workspace();
  const id = newThreadId();
  await saveThread(dir, id, {
    agent: "claude",
    sessionId: null,
    chat: [
      { kind: "tool", id: "t1", title: "Edit Button.tsx", toolKind: "edit", status: "in_progress" },
      { kind: "permission", id: "p1", title: "Run a command", options: [] },
    ],
  });
  await saveThreadList(dir, { active: id, threads: [{ id, title: "Edit", at: 1 }] });
  const saved = (await loadThreads(dir)).threads[0]?.saved;
  assert.equal(saved?.chat[0]?.kind === "tool" && saved.chat[0].status, "failed");
  assert.equal(saved?.chat[1]?.kind === "permission" && saved.chat[1].resolved, "Interrupted by a restart");
});

test("a missing list means no threads, and a thread without its file starts empty", async () => {
  const dir = await workspace();
  assert.deepEqual(await loadThreads(dir), { active: "", threads: [] });
  const id = newThreadId();
  await saveThread(dir, id, { agent: "claude", sessionId: "s", chat: [] });
  await saveThreadList(dir, {
    active: "gone",
    threads: [
      { id, title: "Kept", at: 1 },
      { id: "../escape", title: "Not a thread id", at: 1 },
    ],
  });
  await removeThreadFile(dir, id);
  const loaded = await loadThreads(dir);
  assert.equal(loaded.active, id, "an active thread that is gone falls back to the first");
  assert.deepEqual(
    loaded.threads.map((thread) => [thread.id, thread.saved]),
    [[id, null]],
  );
});

test("a thread is titled after its first prompt, cut at a word", () => {
  assert.equal(threadTitle("  Softer   buttons \nwith more"), "Softer buttons");
  assert.equal(threadTitle(""), UNTITLED);
  const long = threadTitle("Make every card in the dashboard use the new elevation tokens and rounder corners");
  assert.ok(long.endsWith("…") && long.length <= 61, long);
  assert.doesNotMatch(long, / …$/);
});
