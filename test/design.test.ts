import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_DESIGN, validateDesign } from "../shared/design.ts";
import { baseVars, exportCss, exportTailwind } from "../shared/tokens.ts";

/** The default design plus the given component token groups. */
function withComponents(components: Record<string, unknown>) {
  return validateDesign({ ...DEFAULT_DESIGN, components: { ...DEFAULT_DESIGN.components, ...components } });
}

function errors(result: ReturnType<typeof validateDesign>): string {
  return result.ok ? "" : result.errors.join("\n");
}

describe("tokens of added components", () => {
  const starRating = { iconSize: "20px", gap: "var(--space-1)", filled: "var(--color-warning)" };

  test("are accepted next to the baseline groups and become CSS variables", () => {
    const result = withComponents({ starRating });
    assert.ok(result.ok, errors(result));
    const vars = new Map(baseVars(result.design));
    assert.equal(vars.get("--star-rating-icon-size"), "20px");
    assert.equal(vars.get("--star-rating-filled"), "var(--color-warning)");
    assert.equal(vars.get("--button-height-md"), DEFAULT_DESIGN.components.button.heightMd);
  });

  test("are exported with the rest", () => {
    const result = withComponents({ starRating });
    assert.ok(result.ok);
    assert.match(exportCss(result.design), /--star-rating-icon-size: 20px;/);
    assert.match(exportTailwind(result.design), /--star-rating-gap: var\(--space-1\);/);
  });

  test("keep the defaults of the baseline groups", () => {
    const result = validateDesign({ ...DEFAULT_DESIGN, components: { starRating } });
    assert.ok(result.ok, errors(result));
    assert.equal(result.design.components.button.heightMd, DEFAULT_DESIGN.components.button.heightMd);
  });

  test("still reject unknown tokens in a baseline group", () => {
    const result = withComponents({ button: { ...DEFAULT_DESIGN.components.button, heigthMd: "40px" } });
    assert.match(errors(result), /components\.button/);
  });

  test("need camelCase group and token names and safe values", () => {
    assert.match(errors(withComponents({ "star-rating": starRating })), /camelCase/);
    assert.match(errors(withComponents({ starRating: { "icon-size": "20px" } })), /camelCase/);
    assert.match(errors(withComponents({ starRating: { iconSize: "20px; color: red" } })), /cannot contain/);
  });

  test("catch a group that is one letter off a baseline group", () => {
    assert.match(errors(withComponents({ buton: { radius: "4px" } })), /did you mean "button"/);
    assert.match(errors(withComponents({ tooltips: { radius: "4px" } })), /did you mean "tooltip"/);
    // Short names are not checked: a Cart is not a typo of card.
    assert.ok(withComponents({ cart: { radius: "4px" } }).ok);
  });

  test("reject two tokens that would become the same CSS variable", () => {
    assert.match(
      errors(withComponents({ focus: { ringWidth: "1px" } })),
      /--focus-ring-width, which the global token focus\.ringWidth/,
    );
    const clash = withComponents({ buttonGroup: { gap: "4px" }, button: { ...DEFAULT_DESIGN.components.button } });
    assert.ok(clash.ok, "button-group-gap and button-gap differ");
    assert.match(
      errors(withComponents({ starRating: { iconSize: "1px" }, star: { ratingIconSize: "2px" } })),
      /--star-rating-icon-size/,
    );
  });
});
