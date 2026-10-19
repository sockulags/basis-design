import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFromPreview } from "../shared/frame.ts";

describe("full screen messages from the preview", () => {
  test("an open names a view, a screen and a theme", () => {
    assert.deepEqual(
      parseFromPreview({ type: "fullscreen-open", view: "team-members", screen: "member", theme: "dark" }),
      { type: "fullscreen-open", view: "team-members", screen: "member", theme: "dark" },
    );
  });

  test("a theme other than dark is light, and nothing else comes along", () => {
    assert.deepEqual(
      parseFromPreview({ type: "fullscreen-open", view: "team-members", screen: "list", theme: "sepia", extra: 1 }),
      { type: "fullscreen-open", view: "team-members", screen: "list", theme: "light" },
    );
  });

  test("an open without a section id or a screen is dropped", () => {
    assert.equal(parseFromPreview({ type: "fullscreen-open", view: "Team Members", screen: "list" }), null);
    assert.equal(parseFromPreview({ type: "fullscreen-open", view: "team-members" }), null);
    assert.equal(parseFromPreview({ type: "fullscreen-open", view: "team-members", screen: "" }), null);
  });

  test("ids are cut to the chrome's limit", () => {
    const parsed = parseFromPreview({ type: "fullscreen-open", view: "team-members", screen: "s".repeat(200) });
    assert.equal(parsed?.type === "fullscreen-open" && parsed.screen.length, 80);
  });

  test("an exit carries nothing", () => {
    assert.deepEqual(parseFromPreview({ type: "fullscreen-exit", view: "team-members" }), { type: "fullscreen-exit" });
  });
});
