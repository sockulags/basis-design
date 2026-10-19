import assert from "node:assert/strict";
import { test } from "node:test";
import { captureShots, type CaptureList } from "../shared/capture.ts";
import { captureUrl, Keeper, planCapture } from "../server/screenshots.ts";

const list: CaptureList = {
  specimens: [
    { id: "buttons", title: "Buttons", page: "components" },
    { id: "navbar", title: "Navbar", page: "patterns" },
    { id: "team", title: "Team", page: "views" },
  ],
  views: [
    {
      id: "team",
      title: "Team",
      file: "views/Team.specimen.tsx",
      screens: [
        { id: "list", label: "List", shots: captureShots({ widths: [390, 1280], themes: ["light", "dark"] }) },
        { id: "member", label: "Member", shots: captureShots({ widths: [390], height: 700 }) },
      ],
    },
  ],
  problems: [],
};

const sizes = (plan: ReturnType<typeof planCapture>) =>
  plan.shots.map((shot) => `${shot.width}x${shot.fullPage ? "full" : shot.viewportHeight}-${shot.theme}`);

test("a specimen is shot with the defaults of a flow without capture options", () => {
  const plan = planCapture(list, { specimen: "buttons" });
  assert.deepEqual(plan.query, { specimen: "buttons" });
  assert.deepEqual(plan.shots, captureShots(undefined));
});

test("given widths and themes replace the defaults, and empty ones do not", () => {
  const plan = planCapture(list, { specimen: "navbar" }, { widths: [1440, 375], themes: ["light", "dark"] });
  assert.deepEqual(sizes(plan), ["375xfull-light", "1440xfull-light", "375xfull-dark", "1440xfull-dark"]);
  assert.deepEqual(planCapture(list, { specimen: "navbar" }, { widths: [], themes: [] }).shots, captureShots({}));
});

test("a view screen starts from what its flow asks for", () => {
  const plan = planCapture(list, { view: "team", screen: "member" });
  assert.deepEqual(plan.query, { view: "team", screen: "member" });
  assert.deepEqual(sizes(plan), ["390x700-light"]);
  // Without a screen, the first one; a given theme replaces the flow's themes and keeps its widths.
  const first = planCapture(list, { view: "team" }, { themes: ["dark"] });
  assert.deepEqual(first.query, { view: "team", screen: "list" });
  assert.deepEqual(sizes(first), ["390xfull-dark", "1280xfull-dark"]);
  assert.deepEqual(sizes(planCapture(list, { view: "team", screen: "member" }, { height: "full" })), [
    "390xfull-light",
  ]);
});

test("unknown targets are refused with the ids there are", () => {
  assert.throws(
    () => planCapture(list, { specimen: "badge" }),
    /No specimen "badge". There are: buttons, navbar, team/,
  );
  assert.throws(() => planCapture(list, { view: "orders" }), /No view "orders". There are: team/);
  assert.throws(
    () => planCapture(list, { view: "team", screen: "invite" }),
    /no screen "invite". Its screens are: list, member/,
  );
});

test("capture URLs carry the target and the theme", () => {
  assert.equal(
    captureUrl("http://127.0.0.1:5331/capture.html", { view: "team", screen: "a b" }, "dark"),
    "http://127.0.0.1:5331/capture.html?view=team&screen=a+b&theme=dark",
  );
});

function counting(idleMs: number) {
  const events: string[] = [];
  let opened = 0;
  const keeper = new Keeper<number>(
    async () => {
      events.push(`open ${++opened}`);
      return opened;
    },
    async (value) => {
      events.push(`close ${value}`);
    },
    idleMs,
  );
  return { keeper, events };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The margins around the idle times are wide, since timers on a busy CI runner fire tens of milliseconds late.
test("the keeper opens once for overlapping calls and closes after the idle time", async () => {
  const { keeper, events } = counting(300);
  const results = await Promise.all([keeper.use(async (n) => n), keeper.use(async (n) => n)]);
  assert.deepEqual(results, [1, 1]);
  assert.deepEqual(events, ["open 1"]);
  await wait(50);
  // A call within the idle time keeps the same one open and starts the idle time again.
  assert.equal(await keeper.use(async (n) => n), 1);
  await wait(100);
  assert.equal(keeper.isOpen, true);
  await wait(350);
  assert.equal(keeper.isOpen, false);
  assert.deepEqual(events, ["open 1", "close 1"]);
  assert.equal(await keeper.use(async (n) => n), 2);
  await keeper.close();
  assert.deepEqual(events, ["open 1", "close 1", "open 2", "close 2"]);
});

test("the keeper does not close while a call runs, however long it takes", async () => {
  const { keeper, events } = counting(50);
  await keeper.use(async () => wait(200));
  assert.deepEqual(events, ["open 1"]);
  await wait(200);
  assert.deepEqual(events, ["open 1", "close 1"]);
});

test("the keeper tries again after a failed open, and replaces one that died", async () => {
  let attempts = 0;
  let alive = true;
  const keeper = new Keeper<number>(
    async () => {
      if (++attempts === 1) throw new Error("no browser");
      return attempts;
    },
    async () => undefined,
    1000,
    () => alive,
  );
  await assert.rejects(
    keeper.use(async (n) => n),
    /no browser/,
  );
  assert.equal(await keeper.use(async (n) => n), 2);
  alive = false;
  assert.equal(await keeper.use(async (n) => n), 3);
  await keeper.close();
});
