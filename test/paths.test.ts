import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { relativeInside } from "../server/paths.ts";

const base = await mkdtemp(path.join(tmpdir(), "basis-paths-"));
after(() => rm(base, { recursive: true, force: true }));

const root = path.join(base, "workspace");
const outside = path.join(base, "elsewhere");
await mkdir(path.join(root, "components"), { recursive: true });
await mkdir(outside);
await writeFile(path.join(outside, "secret.txt"), "not the agent's");

/** Links `name` inside the workspace to `target`; a junction on Windows, which needs no admin rights. */
async function link(name: string, target: string): Promise<boolean> {
  try {
    await symlink(target, path.join(root, name), process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

describe("relativeInside", () => {
  test("gives the forward-slash path of a file inside, also one that does not exist yet", () => {
    assert.equal(relativeInside(root, path.join(root, "components", "Button.tsx")), "components/Button.tsx");
    assert.equal(relativeInside(root, path.join(root, "components", "new", "Card.tsx")), "components/new/Card.tsx");
    assert.equal(relativeInside(root, root), "");
  });

  test("refuses paths outside, written plainly or with ..", () => {
    assert.equal(relativeInside(root, path.join(outside, "secret.txt")), null);
    assert.equal(relativeInside(root, path.join(root, "components", "..", "..", "elsewhere")), null);
  });

  test("refuses a path through a link that leads out of the folder", async (t) => {
    if (!(await link("components/escape", outside))) return t.skip("this system cannot create links");
    assert.equal(relativeInside(root, path.join(root, "components", "escape", "secret.txt")), null);
    assert.equal(relativeInside(root, path.join(root, "components", "escape", "new.tsx")), null);
  });

  test("refuses a dangling link, since writing through it lands wherever it points", async (t) => {
    if (!(await link("components/dangling", path.join(base, "gone")))) return t.skip("this system cannot create links");
    assert.equal(relativeInside(root, path.join(root, "components", "dangling", "file.tsx")), null);
  });
});
