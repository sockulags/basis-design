import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_DESIGN, type Design } from "../shared/design.ts";
import { changedVars, reachedSpecimens } from "../server/reach.ts";

/*
 * A small workspace: Button and Badge families, a barrel, specimens for each,
 * and two patterns that import different components through the barrel.
 */
let dir = "";

const files: Record<string, string> = {
  "components/Button.module.css": ".button { border-radius: var(--button-radius); color: var(--color-on-primary); }",
  "components/Button.tsx": 'import styles from "./Button.module.css";\nexport function Button() { return null; }',
  "components/Badge.module.css": ".badge { border-radius: var(--badge-radius); }",
  "components/Badge.tsx": 'import styles from "./Badge.module.css";\nexport function Badge() { return null; }',
  "components/index.ts": 'export * from "./Button.tsx";\nexport * from "./Badge.tsx";\n',
  "components/specimen.ts": "export function defineSpecimen(value) { return value; }",
  "components/Button.specimen.tsx":
    'import { Button } from "./Button.tsx";\nimport { defineSpecimen } from "./specimen.ts";',
  "components/Badge.specimen.tsx":
    'import { Badge } from "./Badge.tsx";\nimport { defineSpecimen } from "./specimen.ts";',
  "patterns/Toolbar.tsx":
    'import { Button } from "../components/index.ts";\nexport function Toolbar() { return null; }',
  "patterns/Toolbar.specimen.tsx": 'import { Toolbar } from "./Toolbar.tsx";',
  "patterns/Tags.tsx":
    'import { Badge, type Tone } from "../components/index.ts";\nexport function Tags() { return null; }',
  "patterns/Tags.specimen.tsx": 'import { Tags } from "./Tags.tsx";',
  "patterns/Everything.tsx":
    'import * as ds from "../components/index.ts";\nexport function Everything() { return null; }',
  "patterns/Everything.specimen.tsx": 'import { Everything } from "./Everything.tsx";',
};

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "basis-reach-"));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
});
after(() => rm(dir, { recursive: true, force: true }));

function design(change: (design: Design) => void): Design {
  const copy = structuredClone(DEFAULT_DESIGN);
  change(copy);
  return copy;
}

describe("changedVars", () => {
  test("lists changed tokens and every token that refers to one", () => {
    const after = design((d) => (d.radius.md = "2px"));
    const vars = changedVars(DEFAULT_DESIGN, after);
    assert.ok(vars.has("--radius-md"));
    // The default button and input radius are var(--radius-md).
    assert.ok(vars.has("--button-radius"));
    assert.ok(vars.has("--input-radius"));
    assert.equal(vars.has("--badge-height"), false);
  });

  test("counts a colour changed in either theme", () => {
    const vars = changedVars(
      DEFAULT_DESIGN,
      design((d) => (d.color.dark.onPrimary = "#000")),
    );
    assert.ok(vars.has("--color-on-primary"));
  });
});

describe("reachedSpecimens", () => {
  test("a component token reaches that component and the patterns that import it by name", async () => {
    const after = design((d) => (d.components.badge.radius = "0px"));
    assert.deepEqual(await reachedSpecimens(dir, [], DEFAULT_DESIGN, after), [
      "components/Badge.specimen.tsx",
      "patterns/Everything.specimen.tsx",
      "patterns/Tags.specimen.tsx",
    ]);
  });

  test("a changed file reaches its importers, not the rest of the barrel's users", async () => {
    assert.deepEqual(await reachedSpecimens(dir, ["components/Button.tsx"], DEFAULT_DESIGN, DEFAULT_DESIGN), [
      "components/Button.specimen.tsx",
      "patterns/Everything.specimen.tsx",
      "patterns/Toolbar.specimen.tsx",
    ]);
  });

  test("an import the barrel cannot attribute depends on all of it", async () => {
    await writeFile(path.join(dir, "patterns/Odd.tsx"), 'import { Mystery } from "../components/index.ts";');
    await writeFile(path.join(dir, "patterns/Odd.specimen.tsx"), 'import "./Odd.tsx";');
    const reached = await reachedSpecimens(dir, ["components/Button.tsx"], DEFAULT_DESIGN, DEFAULT_DESIGN);
    assert.ok(reached?.includes("patterns/Odd.specimen.tsx"));
  });

  test("a changed image reaches the views that import it", async () => {
    await mkdir(path.join(dir, "views/assets"), { recursive: true });
    await writeFile(path.join(dir, "views/assets/photo.png"), Buffer.from([137, 80, 78, 71, 0, 255]));
    await writeFile(
      path.join(dir, "views/Shop.specimen.tsx"),
      'import photo from "./assets/photo.png";\nexport default photo;',
    );
    assert.deepEqual(await reachedSpecimens(dir, ["views/assets/photo.png"], DEFAULT_DESIGN, DEFAULT_DESIGN), [
      "views/Shop.specimen.tsx",
    ]);
  });

  test("a global token reaches what uses it through other tokens", async () => {
    const after = design((d) => (d.radius.md = "2px"));
    const reached = await reachedSpecimens(dir, [], DEFAULT_DESIGN, after);
    assert.ok(reached?.includes("components/Button.specimen.tsx"));
    assert.equal(reached?.includes("components/Badge.specimen.tsx"), false);
  });

  test("a token every component inherits reaches everything", async () => {
    assert.equal(
      await reachedSpecimens(
        dir,
        [],
        DEFAULT_DESIGN,
        design((d) => (d.typography.family.sans = "serif")),
      ),
      null,
    );
    assert.equal(
      await reachedSpecimens(
        dir,
        [],
        DEFAULT_DESIGN,
        design((d) => (d.color.light.text = "#111")),
      ),
      null,
    );
  });

  test("nothing changed reaches nothing", async () => {
    assert.deepEqual(await reachedSpecimens(dir, [], DEFAULT_DESIGN, DEFAULT_DESIGN), []);
  });
});
