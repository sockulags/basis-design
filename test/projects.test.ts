import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import { Projects } from "../server/projects.ts";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "basis-projects-"));
  folders.push(dir);
  return dir;
}

/** A folder that looks like a Basis workspace: a design file, and some source. */
async function workspace(dir: string, name: string): Promise<string> {
  await mkdir(path.join(dir, "components"), { recursive: true });
  await writeFile(path.join(dir, "design-system.json"), JSON.stringify({ ...DEFAULT_DESIGN, name }));
  await writeFile(path.join(dir, "components", "Button.tsx"), "export const Button = () => null;\n");
  await mkdir(path.join(dir, ".basis"));
  await writeFile(path.join(dir, ".basis", "chat.json"), "{}");
  return dir;
}

describe("the project list", () => {
  test("a new list starts with the old single workspace, named after its design system", async () => {
    const home = await folder();
    const old = await workspace(path.join(home, "workspace"), "Acme");
    const projects = new Projects(home);
    await projects.load({ fallback: old });
    assert.equal(projects.active?.name, "Acme");
    assert.equal(projects.active?.dir, old);
  });

  test("the list and the open project survive a restart", async () => {
    const home = await folder();
    const first = await workspace(path.join(home, "a"), "First");
    const projects = new Projects(home);
    await projects.load({ fallback: first });
    const second = await projects.create("Second");
    await projects.setActive(second.id);
    const again = new Projects(home);
    await again.load({ fallback: first });
    assert.deepEqual(
      again.list.map((entry) => entry.name),
      ["First", "Second"],
    );
    assert.equal(again.active?.name, "Second");
  });

  test("a one-off workspace (BASIS_WORKSPACE) opens alone and leaves the saved list alone", async () => {
    const home = await folder();
    const first = await workspace(path.join(home, "a"), "First");
    const saved = new Projects(home);
    await saved.load({ fallback: first });
    const test = await workspace(path.join(home, "test"), "Test");
    const oneOff = new Projects(home);
    await oneOff.load({ only: test, fallback: first });
    assert.deepEqual(
      oneOff.list.map((entry) => entry.name),
      ["Test"],
    );
    await oneOff.create("Made during the test");
    const again = new Projects(home);
    await again.load({ fallback: first });
    assert.deepEqual(
      again.list.map((entry) => entry.name),
      ["First"],
    );
    assert.equal(again.active?.name, "First");
  });

  test("a new project gets its own folder and takes its name into the design system", async () => {
    const home = await folder();
    const projects = new Projects(home);
    await projects.load();
    const entry = await projects.create("Acme dashboard");
    assert.equal(entry.dir, path.join(home, "workspaces", "acme-dashboard"));
    const design = JSON.parse(await readFile(path.join(entry.dir, "design-system.json"), "utf8"));
    assert.equal(design.name, "Acme dashboard");
    const twin = await projects.create("Acme dashboard");
    assert.equal(twin.dir, path.join(home, "workspaces", "acme-dashboard-2"));
    assert.notEqual(twin.id, entry.id);
  });

  test("a copy takes the tokens and source, not the history, chat or review", async () => {
    const home = await folder();
    const source = await workspace(path.join(home, "source"), "Source");
    const projects = new Projects(home);
    await projects.load({ fallback: source });
    const copy = await projects.create("Copy", projects.active);
    assert.ok(existsSync(path.join(copy.dir, "components", "Button.tsx")));
    assert.equal(existsSync(path.join(copy.dir, ".basis")), false);
    const design = JSON.parse(await readFile(path.join(copy.dir, "design-system.json"), "utf8"));
    assert.equal(design.name, "Copy");
    assert.equal(design.color.light.primary, DEFAULT_DESIGN.color.light.primary);
  });

  test("a folder opens when it is a workspace, empty or new", async () => {
    const home = await folder();
    const projects = new Projects(home);
    await projects.load();
    const existing = await projects.open(await workspace(path.join(home, "elsewhere"), "Elsewhere"));
    assert.equal(existing.name, "Elsewhere");
    const empty = path.join(home, "empty");
    await mkdir(empty);
    assert.equal((await projects.open(empty)).dir, empty);
    const fresh = path.join(home, "product", "design-system");
    assert.equal((await projects.open(fresh)).dir, fresh);
    assert.ok(existsSync(fresh));
    assert.equal((await projects.open(fresh)).id, (await projects.open(fresh)).id, "opening twice adds it once");
  });

  test("a folder with other files is refused, so Basis never starts a history in someone's project", async () => {
    const home = await folder();
    const projects = new Projects(home);
    await projects.load();
    const repo = path.join(home, "my-app");
    await mkdir(repo);
    await writeFile(path.join(repo, "package.json"), "{}");
    await assert.rejects(projects.open(repo), /not a Basis workspace/);
    await assert.rejects(projects.open("relative/path"), /full path/);
    await assert.rejects(projects.open(path.join(repo, "package.json")), /is a file/);
    assert.equal(projects.list.length, 0);
  });

  test("removing a project keeps its folder, and the open one cannot be removed", async () => {
    const home = await folder();
    const first = await workspace(path.join(home, "a"), "First");
    const projects = new Projects(home);
    await projects.load({ fallback: first });
    const other = await projects.create("Other");
    await projects.remove(projects.active!.id);
    assert.equal(projects.list.length, 2);
    await projects.remove(other.id);
    assert.deepEqual(
      projects.list.map((entry) => entry.name),
      ["First"],
    );
    assert.ok(existsSync(other.dir));
  });
});
