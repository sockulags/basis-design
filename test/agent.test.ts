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
