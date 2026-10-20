import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { localApiToken, TOKEN_FILE } from "../server/api-token.ts";

test("Basis makes its local API token once, keeps it, and only the user can read it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "basis-token-"));
  try {
    const first = await localApiToken(home);
    assert.match(first, /^[0-9a-f]{48}$/);
    assert.equal(await localApiToken(home), first);
    assert.equal((await readFile(path.join(home, TOKEN_FILE), "utf8")).trim(), first);
    if (process.platform !== "win32") assert.equal((await stat(path.join(home, TOKEN_FILE))).mode & 0o777, 0o600);
    // A file too short to be a token is replaced.
    await writeFile(path.join(home, TOKEN_FILE), "short\n");
    assert.notEqual(await localApiToken(home), "short");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
