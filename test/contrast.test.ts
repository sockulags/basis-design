import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contrast, contrastFailures, CONTRAST_PAIRS, type ResolvedColors, type Rgba } from "../shared/contrast.ts";
import { DEFAULT_DESIGN } from "../shared/design.ts";

const hex = (value: string): Rgba => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  assert.ok(match, `${value} is a six-digit hex colour`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16), 1];
};

/** The default design's colours, resolved the way the preview would for the roles the pairs use. */
function defaults(): ResolvedColors {
  const resolved: ResolvedColors = { light: {}, dark: {} };
  for (const theme of ["light", "dark"] as const) {
    for (const { fg, bg } of CONTRAST_PAIRS) {
      resolved[theme][fg] = hex(DEFAULT_DESIGN.color[theme][fg]);
      resolved[theme][bg] = hex(DEFAULT_DESIGN.color[theme][bg]);
    }
  }
  return resolved;
}

describe("contrast", () => {
  test("matches the WCAG extremes", () => {
    assert.equal(contrast([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(1), "21.0");
    assert.equal(contrast([120, 120, 120, 1], [120, 120, 120, 1]), 1);
  });

  test("composites a translucent foreground over the background", () => {
    assert.equal(contrast([0, 0, 0, 0], [255, 255, 255, 1]), 1);
  });

  test("the default design passes every pair", () => {
    assert.deepEqual(contrastFailures(defaults()), []);
  });

  test("names the theme, the pair, the ratio and the target", () => {
    const resolved = defaults();
    resolved.dark.textMuted = hex("#3a3833");
    const [failure, ...rest] = contrastFailures(resolved);
    assert.match(failure ?? "", /^dark textMuted on bg is \d\.\d:1, needs 4\.5:1$/);
    assert.ok(rest.every((item) => item.startsWith("dark textMuted on ")));
  });

  test("skips pairs that are not resolved yet", () => {
    assert.deepEqual(contrastFailures({ light: {}, dark: {} }), []);
  });
});
