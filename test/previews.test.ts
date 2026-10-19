import assert from "node:assert/strict";
import { test } from "node:test";
import { PreviewReports } from "../server/previews.ts";

test("a single tab counts, hidden or not", () => {
  const reports = new PreviewReports<string>();
  reports.report("tab", ["Buttons section: boom"], false);
  assert.deepEqual(reports.current, ["Buttons section: boom"]);
});

test("a visible tab wins over a hidden one, whichever reported last", () => {
  const reports = new PreviewReports<string>();
  reports.report("current", [], true);
  reports.report("stale", ['review.json show[0]: there is no specimen titled "Star rating"'], false);
  assert.deepEqual(reports.current, []);
});

test("of two visible tabs, the one shown most recently wins", () => {
  const reports = new PreviewReports<string>();
  reports.report("first", ["first"], true);
  reports.report("second", ["second"], true);
  reports.report("first", ["first, later"], true);
  assert.deepEqual(reports.current, ["second"], "staying visible does not make a tab current again");
  reports.report("first", ["first"], false);
  reports.report("first", ["first"], true);
  assert.deepEqual(reports.current, ["first"]);
});

test("when every tab is hidden, the one seen last wins", () => {
  const reports = new PreviewReports<string>();
  reports.report("old", ["old"], true);
  reports.report("recent", ["recent"], true);
  reports.report("recent", ["recent"], false);
  reports.report("old", ["old, hidden"], false);
  assert.deepEqual(reports.current, ["recent"]);
});

test("a closed tab no longer counts", () => {
  const reports = new PreviewReports<string>();
  reports.report("closed", ["closed"], true);
  reports.report("open", ["open"], false);
  reports.forget("closed");
  assert.deepEqual(reports.current, ["open"]);
  reports.forget("open");
  assert.deepEqual(reports.current, []);
});

test("the current tab's preview generation goes with its report, and there is none without a tab", () => {
  const reports = new PreviewReports<string>();
  assert.equal(reports.generation, null);
  reports.report("hidden", [], false, [], false, 4);
  reports.report("shown", [], true, [], true, 2);
  assert.equal(reports.generation, 2);
});
