import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { captureShots } from "../shared/capture.ts";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import { CLOCK_SHIFT_MS, shiftClockScript, type RepeatedShot } from "../server/screenshots.ts";
import { sameImage, screenFindings, unreported, ViewStability } from "../server/stability.ts";
import { encodePng } from "../server/verify-kit/compare.mjs";

function png(width: number, height: number, rgb: [number, number, number], marked?: [number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([...rgb, 255], p * 4);
  if (marked) data.set([255, 0, 0, 255], (marked[1] * width + marked[0]) * 4);
  return encodePng({ width, height, data });
}

const shot = captureShots({ widths: [375] })[0]!;
const repeated = (first: Buffer, second: Buffer, error: string | null = null, screen = "list"): RepeatedShot => ({
  view: { id: "team", title: "Team", file: "views/Team.specimen.tsx" },
  screen: { id: screen, label: screen === "list" ? "Members" : "Invite" },
  shot,
  first,
  second,
  error,
});

test("the same pixels count as the same image, also when the files differ", () => {
  const image = png(4, 3, [10, 20, 30]);
  assert.ok(sameImage(image, image));
  // The same pixels in another file: a text chunk after the header, which the decoder skips.
  const text = Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from("tEXtab", "ascii"), Buffer.alloc(4)]);
  const annotated = Buffer.concat([image.subarray(0, 33), text, image.subarray(33)]);
  assert.equal(annotated.equals(image), false);
  assert.ok(sameImage(image, annotated));
  assert.equal(sameImage(image, png(4, 3, [10, 20, 30], [2, 1])), false);
  assert.equal(sameImage(image, png(4, 4, [10, 20, 30])), false);
});

test("findings name the screen, view, file, width and theme, and nothing that changes between runs", () => {
  const stable = png(4, 3, [0, 0, 0]);
  const findings = screenFindings([
    repeated(stable, png(4, 3, [0, 0, 0], [0, 0])),
    repeated(stable, png(4, 3, [0, 0, 0], [3, 2])),
    repeated(stable, stable),
    repeated(stable, stable, "boom is not defined", "invite"),
  ]);
  assert.equal(findings.length, 3);
  assert.equal(
    findings[0]!.text,
    'Screen "Members" (list) of view "Team" (views/Team.specimen.tsx) renders differently each time at 375px; look for clocks, random values or animations that do not settle.',
  );
  // A different difference gives the same text, so the fix loop sees the same problem.
  assert.equal(findings[1]!.text, findings[0]!.text);
  assert.deepEqual(findings[2], {
    file: "views/Team.specimen.tsx",
    view: "Team",
    kind: "failed",
    text: 'Screen "Invite" (invite) of view "Team" (views/Team.specimen.tsx) fails to render at 375px: boom is not defined',
  });
  const dark = { ...repeated(stable, png(4, 3, [9, 9, 9])), shot: { ...shot, theme: "dark" as const } };
  assert.match(screenFindings([dark])[0]!.text, /at 375px in dark;/);
});

test("a failed screen the preview already reports is left out", () => {
  const stable = png(2, 2, [0, 0, 0]);
  const findings = screenFindings([repeated(stable, stable, "boom"), repeated(stable, png(2, 2, [1, 1, 1]))]);
  assert.equal(unreported(findings, ["Team section: boom"]).length, 1);
  assert.equal(unreported(findings, ["Team section: boom"])[0]!.kind, "unstable");
  assert.equal(unreported(findings, ["Teams section: boom", "Vite: syntax error"]).length, 2);
});

test("the shifted clock runs ahead and keeps Date's behaviour", () => {
  const context = vm.createContext({});
  vm.runInContext(shiftClockScript(CLOCK_SHIFT_MS), context);
  const ahead = vm.runInContext("Date.now()", context) as number;
  assert.ok(Math.abs(ahead - Date.now() - CLOCK_SHIFT_MS) < 1000);
  assert.ok(Math.abs((vm.runInContext("new Date().getTime()", context) as number) - ahead) < 1000);
  assert.equal(vm.runInContext("new Date(2026, 0, 2).getDate()", context), 2);
  assert.equal(vm.runInContext("new Date(0).getTime()", context), 0);
  assert.equal(vm.runInContext("new Date() instanceof Date", context), true);
  assert.equal(vm.runInContext("typeof Date()", context), "string");
  assert.equal(vm.runInContext("Date.UTC(2026, 0, 1)", context), Date.UTC(2026, 0, 1));
  // A day, an hour, a minute and a second, so a screen showing any of them changes.
  assert.ok(CLOCK_SHIFT_MS > 86_400_000 + 3_600_000 + 60_000 + 1000);
});

test("only views that changed files reach are photographed, and a failing browser is logged once", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "basis-stability-"));
  try {
    await mkdir(path.join(dir, "views"));
    await mkdir(path.join(dir, "components"));
    await writeFile(path.join(dir, "views", "team-data.ts"), "export const members = [];\n");
    await writeFile(
      path.join(dir, "views", "Team.specimen.tsx"),
      'import { members } from "./team-data.ts";\nexport default { title: "Team", members };\n',
    );
    await writeFile(path.join(dir, "views", "Orders.specimen.tsx"), 'export default { title: "Orders" };\n');
    await writeFile(path.join(dir, "components", "Button.specimen.tsx"), "export default {};\n");
    const asked: string[][] = [];
    const image = png(2, 2, [0, 0, 0]);
    const checker = new ViewStability(
      dir,
      {
        repeat: async (files) => {
          asked.push(files);
          return [repeated(image, png(2, 2, [5, 5, 5]))];
        },
      },
      () => DEFAULT_DESIGN,
    );
    const findings = await checker.check(["views/team-data.ts", "components/Button.tsx", "design-system.json"]);
    assert.deepEqual(asked, [["views/Team.specimen.tsx"]]);
    assert.equal(findings[0]?.kind, "unstable");
    // Nothing in views/ changed: no screenshots at all.
    assert.deepEqual(await checker.check(["components/Button.tsx"]), []);
    assert.equal(asked.length, 1);

    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      const broken = new ViewStability(
        dir,
        {
          repeat: async () => {
            throw new Error("No browser to take the screenshots with.");
          },
        },
        () => DEFAULT_DESIGN,
      );
      assert.deepEqual(await broken.check(["views/Orders.specimen.tsx"]), []);
      assert.deepEqual(await broken.check(["views/Orders.specimen.tsx"]), []);
    } finally {
      console.warn = warn;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /No browser/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
