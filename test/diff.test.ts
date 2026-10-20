import assert from "node:assert/strict";
import { test } from "node:test";
import { diffDesigns } from "../shared/diff.ts";

test("diffDesigns lists changed, added and removed leaves by path", () => {
  const before = { color: { light: { primary: "#000", accent: "#111" } }, space: { 1: "4px" } };
  const after = { color: { light: { primary: "#fff" } }, space: { 1: "4px", 2: "8px" } };
  assert.deepEqual(diffDesigns(before, after), [
    { path: "color.light.primary", before: "#000", after: "#fff" },
    { path: "space.2", before: undefined, after: "8px" },
    { path: "color.light.accent", before: "#111", after: undefined },
  ]);
});
