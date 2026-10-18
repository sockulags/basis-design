import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import { fixedColorFindings, fixedColorsInCss, fixedColorsInValue } from "../shared/fixed-colors.ts";

describe("fixed colours", () => {
  test("finds hex, literal colour functions and white/black", () => {
    assert.deepEqual(fixedColorsInValue("0 1px 2px rgb(15 27 45 / 0.06), inset 0 0 0 1px #FFF"), [
      "rgb(15 27 45 / 0.06)",
      "#fff",
    ]);
    assert.deepEqual(fixedColorsInValue("linear-gradient(white, oklch(0.9 0.02 250))"), [
      "white",
      "oklch(0.9 0.02 250)",
    ]);
  });

  test("passes colours derived from the roles", () => {
    for (const value of [
      "var(--color-primary)",
      "color-mix(in oklab, var(--color-text) 6%, transparent)",
      "oklch(from var(--_bg) calc(l + 0.08) c h)",
      "0 1px 2px color-mix(in srgb, var(--color-shadow) 15%, transparent)",
      "currentColor",
      "var(--surface-white)",
    ]) {
      assert.deepEqual(fixedColorsInValue(value), [], value);
    }
  });

  test("reports a literal inside a derived colour once", () => {
    assert.deepEqual(fixedColorsInValue("color-mix(in srgb, rgb(0 0 0) 10%, var(--color-bg))"), ["rgb(0 0 0)"]);
    assert.deepEqual(fixedColorsInValue("rgb(from white r g b / 0.5)"), ["white"]);
  });

  test("skips selectors, comments, strings, urls, masks and font names", () => {
    const css = `
      /* a white sheen, #fff */
      .button[data-tone="white"] { white-space: nowrap; content: "#1"; background: url(#grain); }
      .fade { mask-image: linear-gradient(black, transparent); font-family: Archivo Black, sans-serif; }
      .bad { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.1); }
    `;
    assert.deepEqual(fixedColorsInCss(css), ["rgba(255, 255, 255, 0.1)"]);
  });

  test("the default design has none outside the colour roles", () => {
    assert.deepEqual(fixedColorFindings(DEFAULT_DESIGN, []), []);
  });

  test("names the token or file each colour is in", () => {
    const design = structuredClone(DEFAULT_DESIGN);
    design.shadow.md = "0 4px 12px rgb(15 27 45 / 0.06)";
    assert.deepEqual(
      fixedColorFindings(design, [{ file: "components/Button.module.css", css: ".b { color: #fff; }" }]),
      [
        "design-system.json shadow.md uses the fixed colour rgb(15 27 45 / 0.06)",
        "components/Button.module.css uses the fixed colour #fff",
      ],
    );
  });
});
