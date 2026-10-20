import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "../shared/protocol.ts";
import { commandPrograms, describeSummary, describeTool, groupChat, shortPath } from "../src/chat/turns.ts";

const tool = (id: string, title: string, toolKind: string, status = "completed"): ChatItem => ({
  kind: "tool",
  id,
  title,
  toolKind,
  status: status as "completed",
});

test("paths read as paths: forward slashes, without the workspace or home folder", () => {
  assert.equal(shortPath(String.raw`Edit views\Audit.specimen.tsx`), "Edit views/Audit.specimen.tsx");
  assert.equal(
    shortPath(`cd "C:/Users/lucas/.basis/workspaces/auth-service/components" && ls`),
    `cd "components" && ls`,
  );
  assert.equal(shortPath("cat C:/Users/lucas/Code/portvakt/README.md"), "cat ~/Code/portvakt/README.md");
  assert.equal(shortPath("ls /home/ada/.basis/workspaces/shop/views"), "ls views");
});

test("a command line says which programs it runs", () => {
  assert.deepEqual(
    commandPrograms(`cd "C:/repo" && ls -la && git ls-files | grep -v x | sed 's|/[^/]*$||' | sort | uniq -c`),
    ["ls", "git", "grep", "sed", "sort", "uniq"],
  );
  assert.deepEqual(commandPrograms(`W=1; for f in a b; do diff "$W/$f" $f; done`), ["diff"]);
  assert.deepEqual(describeTool(`cd "C:/x" && grep -n a b`, "execute"), {
    label: "Ran grep",
    detail: `cd "C:/x" && grep -n a b`,
  });
  assert.equal(describeTool("Read patterns\\DataTable.tsx", "read").label, "Read patterns/DataTable.tsx");
});

test("a turn's work becomes one block, and the answer after it stays", () => {
  const chat: ChatItem[] = [
    { kind: "user", id: "u1", text: "Make it calmer" },
    { kind: "agent", id: "a1", text: "Let me look at the tokens." },
    tool("t1", "Read design-system.json", "read"),
    { kind: "thought", id: "th1", text: "The accent is loud." },
    tool("t2", String.raw`Edit components\Button.module.css`, "edit"),
    tool("t3", String.raw`Edit components\Button.module.css`, "edit"),
    tool("t4", "Screenshot of buttons", "other"),
    { kind: "permission", id: "p1", title: "git log", options: [], resolved: "Yes" },
    { kind: "agent", id: "a2", text: "I toned the accent down." },
  ];
  const blocks = groupChat(chat, false);
  assert.deepEqual(
    blocks.map((block) => (block.type === "work" ? "work" : block.item.id)),
    ["u1", "work", "a2"],
  );
  const work = blocks[1]!;
  assert.ok(work.type === "work");
  assert.deepEqual(
    work.steps.map((step) => step.type),
    ["note", "tool", "thought", "tool", "tool", "allowed"],
  );
  const edits = work.steps[3]!;
  assert.ok(edits.type === "tool" && edits.count === 2, "the same edit twice in a row is one line");
  assert.equal(describeSummary(work.summary), "Edited 2 files · 1 screenshot · read 1 file");
  assert.equal(work.live, false);
});

test("while the last turn runs, its work is live and names the step in progress", () => {
  const chat: ChatItem[] = [
    { kind: "user", id: "u1", text: "Go" },
    tool("t1", "Read a.ts", "read"),
    tool("t2", "Read b.ts", "read", "in_progress"),
  ];
  const [, work] = groupChat(chat, true);
  assert.ok(work?.type === "work");
  assert.equal(work.live, true);
  assert.ok(work.current?.type === "tool" && work.current.label === "Read b.ts");
});

test("questions waiting for an answer, plans and notices stay outside the work", () => {
  const chat: ChatItem[] = [
    { kind: "user", id: "u1", text: "Go" },
    tool("t1", "Read a.ts", "read"),
    { kind: "permission", id: "p1", title: "rm -rf build", options: [] },
    { kind: "notice", id: "n1", text: "Basis refused an edit", tone: "info" },
  ];
  assert.deepEqual(
    groupChat(chat, true).map((block) => (block.type === "work" ? "work" : block.item.id)),
    ["u1", "work", "p1", "n1"],
  );
  assert.equal(
    describeSummary({ read: 0, edited: 0, searched: 0, ran: 1, screenshots: 0, other: 0, failed: 1 }),
    "1 command · 1 failed",
  );
});
