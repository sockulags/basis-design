import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { findClaude } from "../server/claude.ts";

const base = await mkdtemp(path.join(tmpdir(), "basis-claude-"));
after(() => rm(base, { recursive: true, force: true }));

/** Creates a file (and its folders) under the test folder and returns its path. */
async function file(...parts: string[]): Promise<string> {
  const target = path.join(base, ...parts);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "");
  return target;
}

describe("findClaude", () => {
  test("uses CLAUDE_CODE_EXECUTABLE when it names a file", async () => {
    const exe = await file("explicit", "claude.exe");
    const found = findClaude({ env: { CLAUDE_CODE_EXECUTABLE: exe, PATH: "" }, platform: "win32", home: base });
    assert.equal(found, exe);
  });

  test("on Windows, finds claude.exe on the PATH", async () => {
    const exe = await file("native", "claude.exe");
    const found = findClaude({
      env: { PATH: [path.join(base, "empty"), path.dirname(exe)].join(";") },
      platform: "win32",
      home: base,
    });
    assert.equal(found, exe);
  });

  test("on Windows, finds the executable behind the npm shim, which cannot start without a shell", async () => {
    const shim = await file("npm", "claude.cmd");
    const exe = await file("npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    const found = findClaude({ env: { Path: path.dirname(shim) }, platform: "win32", home: base });
    assert.equal(found, exe);
  });

  test("falls back to the native installer's folder, and is null when Claude Code is not installed", async () => {
    const home = path.join(base, "home");
    assert.equal(findClaude({ env: { PATH: "" }, platform: "win32", home }), null);
    const exe = await file("home", ".local", "bin", "claude.exe");
    assert.equal(findClaude({ env: { PATH: "" }, platform: "win32", home }), exe);
  });

  test("on macOS and Linux, finds claude on the PATH, through its links", async (t) => {
    // A Unix PATH splits on ":", which a Windows path (C:\...) cannot go through.
    if (process.platform === "win32") return t.skip("a Unix PATH cannot hold Windows paths");
    const bin = await file("unix", "bin", "claude");
    const found = findClaude({ env: { PATH: `/nowhere:${path.dirname(bin)}` }, platform: "linux", home: base });
    assert.equal(found, realpathSync(bin));
  });
});
