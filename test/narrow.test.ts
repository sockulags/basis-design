import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findSpecimen, narrowSpecimen } from "../src/preview/narrow.ts";
import type { LoadedSpecimen } from "../src/preview/specimens.tsx";

const render = () => null;

const buttons: LoadedSpecimen = {
  id: "buttons",
  title: "Buttons",
  group: "Actions",
  order: 10,
  file: "components/Button.specimen.tsx",
  page: "system",
  blocks: [
    { kind: "matrix", rows: ["primary", "danger"], columns: ["default", "pressed", "disabled"], render },
    {
      kind: "grid",
      title: "Sizes",
      items: [
        { label: "sm", render },
        { label: "lg", render },
      ],
    },
    { kind: "row", title: "Live", render },
  ],
};

function narrowed(target: Parameters<typeof narrowSpecimen>[1]) {
  const result = narrowSpecimen(buttons, target);
  if ("problem" in result) assert.fail(result.problem);
  return result.specimen.blocks;
}

describe("findSpecimen", () => {
  test("matches by id or by title, ignoring case", () => {
    assert.equal(findSpecimen([buttons], "buttons"), buttons);
    assert.equal(findSpecimen([buttons], " BUTTONS "), buttons);
    assert.equal(findSpecimen([buttons], "Tabs"), undefined);
  });
});

describe("narrowSpecimen", () => {
  test("keeps everything without block, rows or columns", () => {
    assert.equal(narrowed({ specimen: "Buttons" }).length, 3);
  });

  test("picks a block by title or by 1-based number", () => {
    assert.equal(narrowed({ specimen: "Buttons", block: "sizes" })[0]?.kind, "grid");
    assert.equal(narrowed({ specimen: "Buttons", block: "1" })[0]?.kind, "matrix");
  });

  test("filters matrix rows and columns and drops blocks without a match", () => {
    const blocks = narrowed({ specimen: "Buttons", rows: ["danger"], columns: ["disabled"] });
    assert.equal(blocks.length, 1);
    const [matrix] = blocks;
    assert.ok(matrix?.kind === "matrix");
    assert.deepEqual(matrix.rows, ["danger"]);
    assert.deepEqual(matrix.columns, ["disabled"]);
  });

  test("filters grid items by row labels", () => {
    const [grid] = narrowed({ specimen: "Buttons", rows: ["lg"] });
    assert.ok(grid?.kind === "grid");
    assert.deepEqual(
      grid.items.map((item) => item.label),
      ["lg"],
    );
  });

  test("keeps a named free-form block even when rows are given", () => {
    assert.equal(narrowed({ specimen: "Buttons", block: "Live", rows: ["primary"] })[0]?.kind, "row");
  });

  test("explains unknown blocks and labels with what exists", () => {
    const block = narrowSpecimen(buttons, { specimen: "Buttons", block: "Variants" });
    assert.ok("problem" in block);
    assert.match(block.problem, /"block 1", "Sizes", "Live"/);
    const rows = narrowSpecimen(buttons, { specimen: "Buttons", rows: ["ghost"] });
    assert.ok("problem" in rows);
    assert.match(rows.problem, /rows "primary", "danger"/);
  });
});
