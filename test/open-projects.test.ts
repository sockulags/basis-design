import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectEntry, ProjectStatus } from "../shared/protocol.ts";
import { OpenProjects, type Openable } from "../server/open-projects.ts";

class Fake implements Openable {
  busy = false;
  waiting = false;
  closed = false;
  constructor(
    readonly entry: ProjectEntry,
    readonly slot: number,
  ) {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

const entry = (id: string): ProjectEntry => ({ id, name: id.toUpperCase(), dir: `/w/${id}` });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(idleMs = 60_000) {
  const opened: string[] = [];
  const reports: Record<string, ProjectStatus>[] = [];
  const projects = new OpenProjects<Fake, string>(
    async (item, slot) => {
      opened.push(item.id);
      await sleep(5);
      return new Fake(item, slot);
    },
    { idleMs, onStatus: (status) => reports.push(status) },
  );
  return { projects, opened, reports };
}

test("a project opens once however many ask, and each open project gets the lowest free slot", async () => {
  const { projects, opened } = setup();
  const [a, again] = await Promise.all([projects.open(entry("a")), projects.open(entry("a"))]);
  assert.equal(a, again);
  const b = await projects.open(entry("b"));
  assert.deepEqual(opened, ["a", "b"]);
  assert.deepEqual([a.slot, b.slot], [0, 1]);
  await projects.close("a");
  assert.equal(a.closed, true);
  assert.equal((await projects.open(entry("c"))).slot, 0);
  await projects.closeAll();
});

test("switching a viewer leaves the project it showed open, and its turn ending unseen marks it done", async () => {
  const { projects, reports } = setup();
  const a = await projects.show("tab", entry("a"));
  a.busy = true;
  projects.update("a");
  assert.deepEqual(projects.statuses(), { a: "working" });
  const b = await projects.show("tab", entry("b"));
  assert.equal(projects.shownBy("tab"), b);
  assert.equal(projects.get("a"), a);
  assert.deepEqual(projects.viewers("a"), []);
  a.waiting = true;
  projects.update("a");
  assert.deepEqual(projects.statuses(), { a: "waiting" });
  a.waiting = false;
  a.busy = false;
  projects.update("a");
  assert.deepEqual(projects.statuses(), { a: "done" });
  // Reported once per change, not on every update.
  projects.update("a");
  assert.deepEqual(reports.at(-1), { a: "done" });
  assert.equal(reports.filter((status) => JSON.stringify(status) === '{"a":"done"}').length, 1);
  // Looking at it clears it.
  await projects.show("tab", entry("a"));
  assert.deepEqual(projects.statuses(), {});
  await projects.closeAll();
});

test("a turn that ends while a viewer shows the project is not marked done", async () => {
  const { projects } = setup();
  const a = await projects.show("tab", entry("a"));
  a.busy = true;
  projects.update("a");
  a.busy = false;
  projects.update("a");
  assert.deepEqual(projects.statuses(), {});
  await projects.closeAll();
});

test("a project nobody shows closes once idle, but not while it works, waits or is shown", async () => {
  const { projects } = setup(30);
  const a = await projects.show("tab", entry("a"));
  const b = await projects.open(entry("b"));
  b.busy = true;
  projects.update("b");
  const c = await projects.open(entry("c"));
  c.waiting = true;
  projects.update("c");
  const d = await projects.open(entry("d"));
  await sleep(80);
  assert.equal(a.closed, false);
  assert.equal(b.closed, false);
  assert.equal(c.closed, false);
  assert.equal(d.closed, true);
  assert.equal(projects.get("d"), undefined);
  // Once b is done and nobody looks, it closes too, and stays marked done.
  b.busy = false;
  projects.update("b");
  await sleep(80);
  assert.equal(b.closed, true);
  assert.deepEqual(projects.statuses(), { b: "done", c: "waiting" });
  // A viewer that leaves starts the clock for the project it showed.
  projects.hide("tab");
  await sleep(80);
  assert.equal(a.closed, true);
  await projects.closeAll();
});

test("a project that fails to open frees its slot", async () => {
  let fail = true;
  const projects = new OpenProjects<Fake, string>(async (item, slot) => {
    if (fail) throw new Error("port in use");
    return new Fake(item, slot);
  });
  await assert.rejects(projects.show("tab", entry("a")), /port in use/);
  assert.equal(projects.isOpen("a"), false);
  assert.equal(projects.shownBy("tab"), undefined);
  fail = false;
  assert.equal((await projects.open(entry("b"))).slot, 0);
  await projects.closeAll();
});
