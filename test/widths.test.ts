import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { parseFromPreview } from "../shared/frame.ts";
import { DEFAULT_WIDTHS, describeWidths, parseWidths, widthList, widthsProblem } from "../shared/widths.ts";
import { copyWidths, readWidths, saveWidths } from "../server/widths.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "basis-widths-"));
  dirs.push(dir);
  return dir;
}

describe("a project's widths", () => {
  test("Basis' defaults are the widths a project had before it could choose them", () => {
    assert.deepEqual(widthList(DEFAULT_WIDTHS), [375, 768, 1440]);
    assert.equal(widthsProblem(DEFAULT_WIDTHS), null);
    assert.equal(
      describeWidths({ mobile: 390, tablet: 768, desktop: 1440 }),
      "Mobile 390px, Tablet 768px and Desktop 1440px",
    );
  });

  test("a set is refused with the reason: out of range, not whole, or not narrowest first", () => {
    assert.match(
      widthsProblem({ mobile: 240, tablet: 768, desktop: 1440 }) ?? "",
      /^Mobile must be a whole number from 280 to 3840px/,
    );
    assert.match(widthsProblem({ mobile: 375, tablet: 768, desktop: 5000 }) ?? "", /^Desktop must be a whole number/);
    assert.match(widthsProblem({ mobile: 390.5, tablet: 768, desktop: 1440 }) ?? "", /^Mobile must be a whole number/);
    assert.match(widthsProblem({ mobile: NaN, tablet: 768, desktop: 1440 }) ?? "", /^Mobile/);
    assert.equal(widthsProblem({ mobile: 800, tablet: 768, desktop: 1440 }), "Mobile must be narrower than Tablet.");
    assert.equal(widthsProblem({ mobile: 390, tablet: 1440, desktop: 1440 }), "Tablet must be narrower than Desktop.");
  });

  test("untrusted widths keep only the three numbers, and an unusable set is dropped", () => {
    assert.deepEqual(parseWidths({ mobile: 390, tablet: 768, desktop: 1440, extra: "x" }), {
      mobile: 390,
      tablet: 768,
      desktop: 1440,
    });
    assert.equal(parseWidths({ mobile: "390", tablet: 768, desktop: 1440 }), null);
    assert.equal(parseWidths(null), null);
    assert.equal(parseWidths([390, 768, 1440]), null);
  });

  test("the control's message from the preview carries a usable set, or null for the defaults", () => {
    assert.deepEqual(parseFromPreview({ type: "widths-set", widths: { mobile: 390, tablet: 768, desktop: 1440 } }), {
      type: "widths-set",
      widths: { mobile: 390, tablet: 768, desktop: 1440 },
    });
    assert.deepEqual(parseFromPreview({ type: "widths-set", widths: null }), { type: "widths-set", widths: null });
    assert.equal(parseFromPreview({ type: "widths-set", widths: { mobile: 1, tablet: 2, desktop: 3 } }), null);
    assert.equal(parseFromPreview({ type: "widths-set" }), null);
  });
});

describe("widths saved in the workspace", () => {
  test("a workspace without the setting, or with a broken one, has the defaults", async () => {
    const dir = await workspace();
    assert.deepEqual(await readWidths(dir), DEFAULT_WIDTHS);
    await mkdir(path.join(dir, ".basis"));
    await writeFile(path.join(dir, ".basis", "widths.json"), "{ not json");
    assert.deepEqual(await readWidths(dir), DEFAULT_WIDTHS);
    await writeFile(
      path.join(dir, ".basis", "widths.json"),
      JSON.stringify({ mobile: 900, tablet: 768, desktop: 1440 }),
    );
    assert.deepEqual(await readWidths(dir), DEFAULT_WIDTHS);
  });

  test("saved widths are read back, and null removes the setting", async () => {
    const dir = await workspace();
    const widths = { mobile: 390, tablet: 820, desktop: 1280 };
    await saveWidths(dir, widths);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, ".basis", "widths.json"), "utf8")), widths);
    assert.deepEqual(await readWidths(dir), widths);
    await saveWidths(dir, null);
    assert.equal(existsSync(path.join(dir, ".basis", "widths.json")), false);
    assert.deepEqual(await readWidths(dir), DEFAULT_WIDTHS);
  });

  test("a copied project gets the widths of the one it was copied from, when it has its own", async () => {
    const from = await workspace();
    const to = await workspace();
    await copyWidths(from, to);
    assert.equal(existsSync(path.join(to, ".basis", "widths.json")), false);
    await saveWidths(from, { mobile: 360, tablet: 768, desktop: 1440 });
    await copyWidths(from, to);
    assert.deepEqual(await readWidths(to), { mobile: 360, tablet: 768, desktop: 1440 });
  });
});
