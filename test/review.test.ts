import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeTarget, parseReviewRequest } from "../shared/review.ts";

describe("parseReviewRequest", () => {
  test("accepts a title and narrowed targets", () => {
    const result = parseReviewRequest(
      JSON.stringify({
        title: " Softer press ",
        show: [{ specimen: "Buttons", block: "1", rows: ["primary"], columns: ["pressed"] }],
      }),
    );
    assert.deepEqual(result, {
      ok: true,
      request: {
        title: "Softer press",
        show: [{ specimen: "Buttons", block: "1", rows: ["primary"], columns: ["pressed"] }],
      },
    });
  });

  test("reports what is missing in words the agent can act on", () => {
    const result = parseReviewRequest(JSON.stringify({ show: [] }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors.join("\n"), /needs a "title"/);
    assert.match(result.errors.join("\n"), /needs a "show" array/);
  });

  test("rejects invalid JSON and malformed labels", () => {
    assert.equal(parseReviewRequest("{ nope").ok, false);
    const labels = parseReviewRequest(JSON.stringify({ title: "x", show: [{ specimen: "Buttons", rows: "primary" }] }));
    assert.equal(labels.ok, false);
  });

  test("keeps at most four targets and ignores unknown keys", () => {
    const show = Array.from({ length: 6 }, (_, index) => ({ specimen: `S${index}`, note: "ignored" }));
    const result = parseReviewRequest(JSON.stringify({ title: "x", show }));
    assert.equal(result.ok && result.request.show.length, 4);
    assert.deepEqual(result.ok && result.request.show[0], {
      specimen: "S0",
      block: undefined,
      rows: undefined,
      columns: undefined,
    });
  });
});

test("describeTarget names the specimen, block and labels", () => {
  assert.equal(describeTarget({ specimen: "Buttons" }), "Buttons");
  assert.equal(describeTarget({ specimen: "Tabs", block: "Pill", rows: ["a"], columns: ["b"] }), "Tabs › Pill · a, b");
});
