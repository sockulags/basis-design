import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HistoryEntry } from "../shared/protocol.ts";
import { undoStep } from "../src/shell/history.ts";

let at = 0;
function entry(id: string, source: HistoryEntry["source"], extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, at: at++, source, name: "Basis", changed: [], files: [], ...extra };
}

describe("undoStep", () => {
  test("undoes the latest step, back to the one before it", () => {
    const history = [entry("a", "init"), entry("b", "agent"), entry("c", "agent")];
    const step = undoStep(history);
    assert.equal(step?.undoes.id, "c");
    assert.equal(step?.target.id, "b");
  });

  test("never undoes a Basis update, which would remove files the workspace needs", () => {
    assert.equal(undoStep([entry("a", "init"), entry("b", "agent"), entry("u", "upgrade")]), null);
    // Earlier versions recorded updates as edits on disk with this label.
    const older = entry("u", "external", { label: "Basis added starter patterns" });
    assert.equal(undoStep([entry("a", "init"), entry("b", "agent"), older]), null);
  });

  test("a change after an update can be undone, and walking back stops at the update", () => {
    const history = [entry("a", "init"), entry("u", "upgrade"), entry("c", "agent")];
    assert.equal(undoStep(history)?.target.id, "u");
    const afterUndo = [...history, entry("r", "revert", { restoredFrom: "u" })];
    assert.equal(undoStep(afterUndo), null);
  });

  test("an ordinary edit on disk can still be undone", () => {
    const step = undoStep([entry("a", "init"), entry("e", "external")]);
    assert.equal(step?.undoes.id, "e");
  });
});
