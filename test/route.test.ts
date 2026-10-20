import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFromPreview } from "../shared/frame.ts";
import { formatRoute, parseRoute } from "../src/shell/route.ts";

test("an address names the project, the page, a section alone or the whole page", () => {
  assert.deepEqual(parseRoute("/p/auth-service/patterns", ""), {
    project: "auth-service",
    page: "patterns",
    focus: null,
    all: false,
  });
  assert.deepEqual(parseRoute("/p/auth-service/views/sign-in", ""), {
    project: "auth-service",
    page: "views",
    focus: "sign-in",
    all: false,
  });
  assert.equal(parseRoute("/p/auth-service/system", "?all").all, true);
});

test("addresses that are not Basis' own say nothing about where to be", () => {
  assert.deepEqual(parseRoute("/", ""), { project: null, page: null, focus: null, all: false });
  assert.equal(parseRoute("/p/x/nowhere/button", "").page, null);
  assert.equal(parseRoute("/p/x/nowhere/button", "").focus, null);
  assert.equal(parseRoute("/p/x/system/<script>", "").focus, null);
  assert.equal(parseRoute("/p/%E0%A4%A/system", "").project, null);
});

test("formatting and parsing agree", () => {
  for (const route of [
    { project: "my project", page: "system" as const, focus: null, all: false },
    { project: "a", page: "patterns" as const, focus: "data-table", all: false },
    { project: "a", page: "views" as const, focus: null, all: true },
  ]) {
    const url = new URL(formatRoute(route), "http://local");
    assert.deepEqual(parseRoute(url.pathname, url.search), route);
  }
});

test("the gallery's navigate message is narrowed to a section id or the page", () => {
  assert.deepEqual(parseFromPreview({ type: "navigate", focus: "button" }), { type: "navigate", focus: "button" });
  assert.deepEqual(parseFromPreview({ type: "navigate", focus: null, all: true }), {
    type: "navigate",
    focus: null,
    all: true,
  });
  assert.equal(parseFromPreview({ type: "navigate", focus: 4 }), null);
  assert.equal(parseFromPreview({ type: "navigate", focus: "../../x" }), null);
});
