import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { suggestRepos } from "../server/folders.ts";

const home = await mkdtemp(path.join(tmpdir(), "basis-home-"));
after(() => rm(home, { recursive: true, force: true }));

/** A git repo at `dir` under the home folder, last used `daysAgo` days ago (by its git index). */
async function repo(dir: string, daysAgo: number): Promise<void> {
  const git = path.join(home, dir, ".git");
  await mkdir(git, { recursive: true });
  await writeFile(path.join(git, "index"), "");
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  await utimes(path.join(git, "index"), at, at);
}

describe("suggestRepos", () => {
  test("finds repos in the usual code folders, two levels down, the most recently used first", async () => {
    await repo("Code/old-app", 30);
    await repo("Code/new-app", 1);
    await repo("Projects/client/portal", 5);
    await repo("Code/a/b/too-deep", 0);
    await repo("Code/node_modules/some-package", 0);
    await repo("Elsewhere/not-a-code-folder", 0);
    const found = await suggestRepos(home);
    assert.deepEqual(
      found.map((suggestion) => suggestion.name),
      ["new-app", "portal", "old-app"],
    );
    assert.equal(found[0]?.dir, path.join(home, "Code", "new-app"));
  });

  test("never suggests the code folder itself, and leaves out the folders it is told to skip", async () => {
    await repo("Code", 0);
    const found = await suggestRepos(home, [path.join(home, "Code", "new-app")]);
    assert.ok(!found.some((suggestion) => suggestion.dir === path.join(home, "Code")));
    assert.ok(!found.some((suggestion) => suggestion.name === "new-app"));
    assert.ok(found.some((suggestion) => suggestion.name === "old-app"));
  });
});
