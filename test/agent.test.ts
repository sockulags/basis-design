import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { ChatItem } from "../shared/protocol.ts";
import { AgentHost, sessionMeta } from "../server/agent.ts";
import { Workspace } from "../server/workspace.ts";

const root = await mkdtemp(path.join(tmpdir(), "basis-agent-"));
// The host saves its chat shortly after the chat changes (scheduleSave), so the folders go once that is done.
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(root, { recursive: true, force: true });
});

const OPTIONS: acp.PermissionOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

/** An agent host for a workspace and a linked repo, with its permission handling reachable. */
async function host(dir: string, repo: string) {
  await mkdir(path.join(dir, ".basis"), { recursive: true });
  await mkdir(repo, { recursive: true });
  const agent = new AgentHost(new Workspace(dir), "claude", repo, [], root);
  const items: ChatItem[] = [];
  agent.on("chat", (item) => items.push(item));
  const ask = (kind: acp.ToolKind, file: string) =>
    (agent as unknown as { onPermission(params: unknown): Promise<acp.RequestPermissionResponse> }).onPermission({
      sessionId: "s",
      options: OPTIONS,
      toolCall: { toolCallId: `call-${items.length}`, kind, title: kind, locations: [{ path: file }] },
    });
  return { agent, items, ask };
}

const chosen = (response: acp.RequestPermissionResponse) =>
  response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled";

describe("a linked product repo", () => {
  test("is one of Claude Code's working directories, next to the settings that keep the user's own out", () => {
    const repo = path.join(root, "product");
    assert.deepEqual(sessionMeta(repo).claudeCode.options, {
      settingSources: [],
      strictMcpConfig: true,
      allowDangerouslySkipPermissions: false,
      additionalDirectories: [repo],
    });
    assert.equal("additionalDirectories" in sessionMeta(undefined).claudeCode.options, false);
  });

  test("is read without asking, and an edit there is refused without asking", async () => {
    const dir = path.join(root, "a", "workspace");
    const repo = path.join(root, "a", "product");
    const { items, ask } = await host(dir, repo);
    assert.equal(chosen(await ask("read", path.join(repo, "src", "App.tsx"))), "allow");
    assert.equal(chosen(await ask("search", repo)), "allow");
    assert.equal(chosen(await ask("edit", path.join(dir, "components", "Button.tsx"))), "allow");
    assert.equal(chosen(await ask("edit", path.join(repo, "src", "App.tsx"))), "reject");
    assert.ok(items.some((item) => item.kind === "notice" && item.text.includes("refused an edit")));
    assert.ok(!items.some((item) => item.kind === "permission"), "nothing was put to the user");
  });

  test("is surveyed with Claude's shell commands after a cd there, without asking", async () => {
    const dir = path.join(root, "c", "workspace");
    const repo = path.join(root, "c", "product");
    const { agent, items } = await host(dir, repo);
    const run = (command: string, name = "Bash") =>
      (agent as unknown as { onPermission(params: unknown): Promise<acp.RequestPermissionResponse> }).onPermission({
        sessionId: "s",
        options: OPTIONS,
        toolCall: { toolCallId: `bash-${items.length}`, name, kind: "execute", title: command, rawInput: { command } },
      });
    const survey = `cd "${repo}" && ls -la && git ls-files | grep -v node_modules | sed 's|/[^/]*$||' | sort | uniq -c`;
    assert.equal(chosen(await run(survey)), "allow");
    assert.ok(!items.some((item) => item.kind === "permission"), "nothing was put to the user");
    for (const [command, name] of [
      [`cd "${repo}" && rm -rf src`, "Bash"],
      [`cd "${repo}" && ls`, "PowerShell"],
    ] as const) {
      const pending = run(command, name);
      const question = items.findLast((item) => item.kind === "permission" && !item.resolved);
      assert.ok(question, `${name} ${command} asks`);
      agent.resolvePermission(question.id, null);
      assert.equal(chosen(await pending), "cancelled");
    }
  });

  test("around the workspace still leaves the workspace's other files to the user", async () => {
    const repo = path.join(root, "b", "product");
    const dir = path.join(repo, "design");
    const { agent, items, ask } = await host(dir, repo);
    assert.equal(chosen(await ask("edit", path.join(dir, "components", "Button.tsx"))), "allow");
    assert.equal(chosen(await ask("edit", path.join(repo, "package.json"))), "reject");
    const pending = ask("edit", path.join(dir, "AGENTS.md"));
    const question = items.find((item) => item.kind === "permission");
    assert.ok(question, "an edit to a workspace file the agent may not change asks, as before");
    agent.resolvePermission(question.id, null);
    assert.equal(chosen(await pending), "cancelled");
  });
});

describe("after a turn, the fix loop", () => {
  /** The host's wait for the preview, with the generation the last turn's reload carries. */
  function waiting(reloaded: number | null) {
    const agent = new AgentHost(new Workspace(path.join(root, "fix")), "claude", undefined, [], root);
    const inner = agent as unknown as { reloaded: number | null; previewSettled(): Promise<boolean> };
    inner.reloaded = reloaded;
    return { agent, settled: () => inner.previewSettled() };
  }

  test("waits for the gallery reloaded after the turn, and then for its checks", async () => {
    const { agent, settled } = waiting(3);
    agent.setPreviewErrors(["Buttons section: from before the turn"], [], false, 2);
    let done = false;
    const result = settled().then((fresh) => ((done = true), fresh));
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(done, false, "a report from before the reload is not the turn's");
    agent.setPreviewErrors([], [], true, 3);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(done, false, "the reloaded gallery is still checking");
    agent.setPreviewErrors([], [], false, 3);
    assert.equal(await result, true);
  });

  test("takes the report as it is when the turn changed nothing the preview shows", async () => {
    const { agent, settled } = waiting(null);
    agent.setPreviewErrors([], [], false, 2);
    assert.equal(await settled(), true);
  });

  test("has no report to go on when no tab shows the preview", async () => {
    const { settled } = waiting(1);
    assert.equal(await settled(), false);
  });
});

describe("the layout check after the user changes the widths", () => {
  const layout = (width: number) =>
    `Layout: Navbar, light, at ${width}px: content does not fit the frame: it runs past an edge or scrolls sideways, for example <nav>`;
  const mobile = { mobile: 390, tablet: 768, desktop: 1440 };

  function fixLoop() {
    const agent = new AgentHost(new Workspace(path.join(root, "widths")), "claude", undefined, [], root);
    const inner = agent as unknown as { noteChecksBefore(): void; collectProblems(): Promise<string | null> };
    return { agent, turnStarts: () => inner.noteChecksBefore(), problems: () => inner.collectProblems() };
  }

  test("does not blame a turn for findings at the new widths the preview had not checked when it started", async () => {
    const { agent, turnStarts, problems } = fixLoop();
    agent.setPreviewErrors([], [], false, 1);
    agent.widthsChanged(mobile, { mobile: 375, tablet: 768, desktop: 1440 });
    // A report from before the preview saw the new widths does not count as their check.
    agent.setPreviewErrors([], [], false, 1);
    turnStarts();
    agent.setPreviewErrors([], [layout(390), layout(1440)], false, 1);
    const sent = (await problems()) ?? "";
    assert.ok(!sent.includes("at 390px"), "the finding at the new width is the user's change");
    assert.ok(sent.includes("at 1440px"), "a finding at a width that did not change is the turn's");
    assert.ok(sent.includes("the project's Mobile width, 375px"));
  });

  test("blames the next turn once the preview has checked the new widths", async () => {
    const { agent, turnStarts, problems } = fixLoop();
    agent.setPreviewErrors([], [], false, 1);
    agent.widthsChanged(mobile, { mobile: 375, tablet: 768, desktop: 1440 });
    agent.setPreviewErrors([], [], true, 1);
    agent.setPreviewErrors([], [], false, 1);
    turnStarts();
    agent.setPreviewErrors([], [layout(390)], false, 1);
    assert.match((await problems()) ?? "", /at 390px/);
  });

  test("leaves findings at widths the user chose during the turn out of it", async () => {
    const { agent, turnStarts, problems } = fixLoop();
    agent.setPreviewErrors([], [], false, 1);
    turnStarts();
    agent.widthsChanged(mobile, { mobile: 375, tablet: 768, desktop: 1440 });
    agent.setPreviewErrors([], [], true, 1);
    agent.setPreviewErrors([], [layout(390)], false, 1);
    assert.equal(await problems(), null);
  });
});

describe("threads", () => {
  /** Waits for a condition the agent reaches on its own. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done(); waited += 50) {
      if (waited > 20_000) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const replies = (agent: AgentHost, thread: string) =>
    (agent.threadChat(thread) ?? []).flatMap((item) => (item.kind === "agent" ? [item.text] : []));
  const prompts = (agent: AgentHost, thread: string) =>
    (agent.threadChat(thread) ?? []).flatMap((item) => (item.kind === "user" ? [item.text] : []));

  test("take turns in one queue, each in its own session, and resume their own after a restart", async () => {
    const script = process.env.BASIS_AGENT_SCRIPT;
    process.env.BASIS_AGENT_SCRIPT = path.join(import.meta.dirname, "e2e", "fake-agent.mjs");
    const dir = path.join(root, "threads");
    const workspace = new Workspace(dir, { typecheck: async () => [] });
    await workspace.init();
    const hosts: AgentHost[] = [];
    try {
      const agent = new AgentHost(workspace, "claude", undefined, [], root);
      hosts.push(agent);
      await agent.restore();
      await agent.start();
      assert.equal(agent.agent.status, "ready");
      const first = agent.activeThread;
      assert.equal(agent.newThread(), first, "an empty thread is new enough, so no other is made");

      // The first thread's slow turn runs; the second thread's prompt waits for it.
      const both = agent.prompt("E2E-SLOW E2E-WHO first", {}, { thread: first });
      await until(() => agent.threadList.find((thread) => thread.id === first)?.status === "working");
      const second = agent.newThread();
      assert.notEqual(second, first);
      await agent.prompt("E2E-WHO second", {}, { thread: second });
      assert.equal(agent.threadList.find((thread) => thread.id === second)?.status, "queued");
      assert.equal(agent.removeThread(second), false, "a queued thread stays");
      await both;
      assert.deepEqual(
        agent.threadList.map(({ title, status }) => [title, status]),
        [
          ["E2E-WHO second", undefined],
          ["E2E-SLOW E2E-WHO first", undefined],
        ],
      );
      assert.deepEqual(prompts(agent, first), ["E2E-SLOW E2E-WHO first"]);
      assert.deepEqual(prompts(agent, second), ["E2E-WHO second"]);
      const session = (thread: string) => /Session (\S+) new\./.exec(replies(agent, thread).join(" "))?.[1];
      assert.ok(session(first) && session(second) && session(first) !== session(second), "a session each");
      // Each history entry names the thread its turn ran in.
      assert.deepEqual(
        workspace.entries.slice(-2).map((entry) => entry.thread),
        ["E2E-SLOW E2E-WHO first", "E2E-WHO second"],
      );

      await agent.stop();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const restarted = new AgentHost(workspace, "claude", undefined, [], root);
      hosts.push(restarted);
      await restarted.restore();
      assert.equal(restarted.activeThread, second, "the thread shown last is shown again");
      assert.deepEqual(prompts(restarted, first), ["E2E-SLOW E2E-WHO first"]);
      await restarted.start();
      await restarted.prompt("E2E-WHO again", {}, { thread: first });
      await restarted.prompt("E2E-WHO again", {}, { thread: second });
      assert.match(replies(restarted, first).at(-1) ?? "", new RegExp(`Session ${session(first)} resumed`));
      assert.match(replies(restarted, second).at(-1) ?? "", new RegExp(`Session ${session(second)} resumed`));
    } finally {
      for (const host of hosts) await host.stop();
      await workspace.close();
      if (script === undefined) delete process.env.BASIS_AGENT_SCRIPT;
      else process.env.BASIS_AGENT_SCRIPT = script;
    }
  });
});
