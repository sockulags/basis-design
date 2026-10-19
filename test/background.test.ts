import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import type { PreviewView } from "../shared/frame.ts";
import { DEFAULT_WIDTHS } from "../shared/widths.ts";
import { BackgroundPreview, pageForFiles, parseReport, type BackgroundReport } from "../server/background.ts";
import { OpenProjects } from "../server/open-projects.ts";

test("the background gallery shows the page with most of the turn's files", () => {
  assert.equal(pageForFiles([]), "system");
  assert.equal(pageForFiles(["design-system.json"]), "system");
  assert.equal(pageForFiles(["views/Team.specimen.tsx", "views/team-data.ts", "components/Button.tsx"]), "views");
  assert.equal(pageForFiles(["patterns/Navbar.tsx"]), "patterns");
  // A tie goes to the earlier page.
  assert.equal(pageForFiles(["patterns/Navbar.tsx", "components/Button.tsx"]), "system");
});

test("a report from the page keeps only what has the right shape", () => {
  assert.deepEqual(parseReport({ errors: ["a", 1], checks: "x", checking: true, generation: 3 }), {
    errors: ["a"],
    checks: [],
    checking: true,
    generation: 3,
  });
  assert.deepEqual(parseReport(null), { errors: [], checks: [], checking: false, generation: 0 });
});

const view: PreviewView = {
  design: {} as PreviewView["design"],
  theme: "light",
  page: "system",
  review: null,
  fullscreen: null,
  widths: DEFAULT_WIDTHS,
};

/** Pages that report what the host page would, held open until the session stops. */
function fakePages(fail = false) {
  const calls: string[] = [];
  let pushReport: ((raw: unknown) => void) | undefined;
  return {
    calls,
    report: (raw: unknown) => pushReport?.(raw),
    source: {
      async withPage<R>(work: (page: Page) => Promise<R>): Promise<R> {
        calls.push("open");
        if (fail) throw new Error("No browser to take the screenshots with.");
        const page = {
          exposeFunction: async (name: string, fn: (raw: unknown) => void) => {
            if (name === "basisReport") pushReport = fn;
          },
          goto: async (url: string) => calls.push(url),
        } as unknown as Page;
        try {
          return await work(page);
        } finally {
          calls.push("closed");
        }
      },
    },
  };
}

test("the background gallery reports for the project from start to stop, and nothing after", async () => {
  const pages = fakePages();
  const reports: (BackgroundReport | null)[] = [];
  const background = new BackgroundPreview(
    pages.source,
    5999,
    "http://localhost:5320",
    () => view,
    (report) => reports.push(report),
  );
  background.start();
  background.start();
  // The fix loop waits for a first real report as for a gallery still loading.
  assert.deepEqual(reports, [{ errors: [], checks: [], checking: true, generation: -1 }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pages.calls, ["open", "http://localhost:5320/background.html?port=5999"]);
  pages.report({ errors: ["Broken section: oops"], checks: [], checking: false, generation: 2 });
  assert.deepEqual(reports.at(-1), { errors: ["Broken section: oops"], checks: [], checking: false, generation: 2 });
  background.stop();
  assert.equal(reports.at(-1), null);
  assert.equal(background.active, false);
  // A report on the way out of a stopped page is not taken.
  pages.report({ errors: ["late"], checks: [], checking: false, generation: 3 });
  assert.equal(reports.at(-1), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pages.calls.at(-1), "closed");
});

test("a browser that cannot start is not tried again until the next stop", async () => {
  const pages = fakePages(true);
  const reports: (BackgroundReport | null)[] = [];
  const background = new BackgroundPreview(
    pages.source,
    5999,
    "http://localhost:5320",
    () => view,
    (report) => reports.push(report),
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    background.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reports.at(-1), null);
    background.start();
    assert.deepEqual(pages.calls, ["open"]);
    background.stop();
    background.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(pages.calls, ["open", "open"]);
  } finally {
    console.warn = warn;
  }
});

test("open projects are told whether a viewer shows them", async () => {
  const shown: [string, boolean][] = [];
  const projects = new OpenProjects<
    {
      entry: { id: string; name: string; dir: string };
      busy: boolean;
      waiting: boolean;
      setShown(s: boolean): void;
      close(): Promise<void>;
    },
    string
  >(async (entry) => ({
    entry,
    busy: false,
    waiting: false,
    setShown: (value) => shown.push([entry.id, value]),
    close: async () => {},
  }));
  await projects.show("tab", { id: "a", name: "A", dir: "/a" });
  await projects.show("tab", { id: "b", name: "B", dir: "/b" });
  assert.deepEqual(shown.at(-2), ["a", false]);
  assert.deepEqual(shown.at(-1), ["b", true]);
  await projects.closeAll();
});
