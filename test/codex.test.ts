import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CODEX_SETTINGS, codexEnv } from "../server/codex.ts";

const base = await mkdtemp(path.join(tmpdir(), "basis-codex-"));
after(() => rm(base, { recursive: true, force: true }));

/** A user's Codex home (with a login when `login` is given) and a Basis home, in their own test folder. */
async function homes(name: string, login?: string): Promise<{ user: string; basis: string; own: string }> {
  const user = path.join(base, name, "user-codex");
  const basis = path.join(base, name, "basis");
  await mkdir(user, { recursive: true });
  if (login !== undefined) await writeFile(path.join(user, "auth.json"), login);
  return { user, basis, own: path.join(basis, "codex") };
}

const where = (user: string) => ({ env: { CODEX_HOME: user }, platform: process.platform, home: base });

describe("codexEnv", () => {
  test("gives Codex a home of Basis' own that shares the user's login file", async () => {
    const { user, basis, own } = await homes("shared", '{"tokens":"first"}');
    const env = codexEnv(basis, where(user));
    assert.equal(env.CODEX_HOME, own);
    assert.equal(await readFile(path.join(own, "auth.json"), "utf8"), '{"tokens":"first"}');
    // Codex rewrites auth.json in place when it refreshes a token; the user's own login must follow.
    await writeFile(path.join(own, "auth.json"), '{"tokens":"refreshed"}');
    assert.equal(await readFile(path.join(user, "auth.json"), "utf8"), '{"tokens":"refreshed"}');
  });

  test("passes the settings that turn off skills, apps, plugins, memories and hooks", async () => {
    const { user, basis } = await homes("settings", "{}");
    const settings = JSON.parse(codexEnv(basis, where(user)).CODEX_CONFIG!);
    assert.deepEqual(settings, CODEX_SETTINGS);
    assert.equal(settings.skills.include_instructions, false);
    assert.equal(settings.skills.bundled.enabled, false);
  });

  test("without a login file, keeps the user's home and removes an earlier link", async () => {
    const { user, basis, own } = await homes("logged-out", "{}");
    codexEnv(basis, where(user));
    await rm(path.join(user, "auth.json"));
    const env = codexEnv(basis, where(user));
    assert.equal(env.CODEX_HOME, undefined);
    assert.ok(env.CODEX_CONFIG);
    assert.equal(existsSync(path.join(own, "auth.json")), false);
  });

  test("finds the user's home in ~/.codex when CODEX_HOME is not set", async () => {
    const home = path.join(base, "plain");
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(path.join(home, ".codex", "auth.json"), "{}");
    const env = codexEnv(path.join(home, "basis"), { env: {}, platform: process.platform, home });
    assert.equal(env.CODEX_HOME, path.join(home, "basis", "codex"));
  });
});
