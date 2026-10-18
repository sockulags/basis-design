import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { AGENT_BRIEF, viewInstruction } from "../server/brief.ts";
import { repoRoot } from "../server/paths.ts";

/** The agent finds guideline sections by the names the brief and the instructions give them. */
describe("guidelines", () => {
  test("every section the brief and the instructions name exists, and every section is named", async () => {
    const text = await readFile(path.join(repoRoot, "server", "guidelines.md"), "utf8");
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
    const prompts = `${AGENT_BRIEF}\n${viewInstruction("views", "Orders", "")}`;
    for (const quoted of ["Before you reply", "Screens and flows", "Writing", "Data"]) {
      assert.ok(headings.includes(quoted), `guidelines.md has a section "${quoted}"`);
    }
    for (const heading of headings.filter((name) => name !== "Sources")) {
      assert.ok(prompts.includes(heading), `the brief points the agent to "${heading}"`);
    }
  });
});
