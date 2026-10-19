import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { expect, gallery, historyCount, open, prompt, test } from "./basis.ts";

test("the gallery renders the design system in its sandbox", async ({ page, basis }) => {
  await open(page, basis);
  await expect(gallery(page).getByRole("heading", { name: "Buttons", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buttons" })).toBeVisible();
});

test("an agent turn becomes one history entry, and Undo takes it back", async ({ page, basis }) => {
  await open(page, basis);
  const before = await historyCount(page);
  const fast = await basis.token("motion.duration.fast");
  await prompt(page, "Make fast motion a little slower");
  await expect.poll(() => historyCount(page)).toBe(before + 1);
  expect(await basis.token("motion.duration.fast")).not.toBe(fast);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => basis.token("motion.duration.fast")).toBe(fast);
});

test("a review the agent opens can be approved as one history entry", async ({ page, basis }) => {
  await open(page, basis);
  const before = await historyCount(page);
  await prompt(page, "E2E-REVIEW slower fast motion");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeEnabled();
  const changed = await basis.token("motion.duration.fast");
  await approve.click();
  await expect(approve).toBeHidden();
  await expect.poll(() => historyCount(page)).toBe(before + 1);
  expect(await basis.token("motion.duration.fast")).toBe(changed);
});

test("discarding a review puts everything back", async ({ page, basis }) => {
  await open(page, basis);
  const fast = await basis.token("motion.duration.fast");
  await prompt(page, "E2E-REVIEW slower fast motion");
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  await discard.click();
  await page.getByRole("button", { name: "Discard all changes?" }).click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeHidden();
  await expect.poll(() => basis.token("motion.duration.fast")).toBe(fast);
});

test("a turn that writes a new view in steps shows it once it ends, with no errors from the middle", async ({
  page,
  basis,
}) => {
  await open(page, basis);
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await expect(gallery(page).getByRole("heading", { name: "Team members", exact: true })).toBeVisible();
  await page.getByPlaceholder(/Describe a change/).fill("E2E-VIEW a view that needs its data");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Mid-turn the gallery waits, and says so.
  await expect(page.getByRole("status").filter({ hasText: "Changes show when the agent is done" })).toBeVisible();
  await expect(gallery(page).getByRole("heading", { name: "Later view", exact: true })).toHaveCount(0);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(gallery(page).getByText("Written last")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Changes show when the agent is done" })).toHaveCount(0);
  await expect(page.getByText(/problems? in the workspace/)).toHaveCount(0);
});

test("the starter kit downloads with tokens and components", async ({ page, basis }) => {
  const response = await page.request.get(`${basis.url}/export/starter-kit.zip`);
  expect(response.ok()).toBe(true);
  const files = Object.keys(unzipSync(new Uint8Array(await response.body())));
  expect(files.some((file) => file.endsWith("/tokens.css"))).toBe(true);
  expect(files.some((file) => file.includes("/components/Button.tsx"))).toBe(true);
  expect(files.some((file) => file.includes("/views/"))).toBe(false);
});

test("the Patterns and Views pages list their sections", async ({ page, basis }) => {
  await open(page, basis);
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("link", { name: "Navbar" })).toBeVisible();
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await expect(page.getByRole("link", { name: "Team members" })).toBeVisible();
});

test("a view opens in full screen, moves through its flow there and comes back to the screen it reached", async ({
  page,
  basis,
}) => {
  await open(page, basis);
  await page.getByRole("button", { name: "Views", exact: true }).click();
  const frame = gallery(page);
  await frame.getByRole("button", { name: "Full screen", exact: true }).click();

  // The frame covers the whole window, Basis' chrome included, and the screen has its full width.
  const view = frame.getByRole("region", { name: "Team members, full screen" });
  await expect(view.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  const { width, height } = page.viewportSize()!;
  await expect
    .poll(() => page.locator('iframe[src*="preview.html"]').boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width,
      height,
    });
  expect((await view.locator("form.ds-root").boundingBox())?.width).toBe(width);

  // Through the flow by its own buttons, then by the bar, which shows when the pointer nears the top.
  await view.getByRole("button", { name: /Grace Hopper/ }).click();
  await expect(view.getByRole("heading", { name: "Grace Hopper", exact: true })).toBeVisible();
  await page.mouse.move(width / 2, 4);
  const bar = view.getByRole("toolbar", { name: "Full screen" });
  await bar.getByRole("combobox", { name: "Screen" }).selectOption("invite");
  await expect(view.getByRole("heading", { name: "Invite a member", exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(view.locator("form.ds-root")).toHaveAttribute("data-theme", "dark");

  // Esc leaves, back to the gallery on the screen reached.
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect((await page.locator('iframe[src*="preview.html"]').boundingBox())?.width).toBeLessThan(width);
  const strip = frame.getByRole("group", { name: "Screens" });
  await expect(strip.getByRole("button", { name: /Invite/ })).toHaveAttribute("aria-pressed", "true");
  await expect(frame.getByRole("heading", { name: "Invite a member", exact: true })).toBeVisible();
});

test("the Navbar keeps its links in a wide gallery and moves them behind a menu on a phone", async ({
  page,
  basis,
}) => {
  await open(page, basis);
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  const frame = gallery(page);
  const navbar = frame.locator('[data-ds="navbar"]').first();
  await expect(navbar.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(navbar.getByRole("button", { name: "Open menu" })).toBeHidden();

  // Show at adds widths; with Fit off, every block is shown at phone width only.
  await frame.getByRole("button", { name: "Mobile", exact: true }).click();
  await frame.getByRole("button", { name: "Fit", exact: true }).click();
  const phone = frame.locator('[data-ds="navbar"]').first();
  const menuButton = phone.getByRole("button", { name: "Open menu" });
  await expect(menuButton).toBeVisible();
  await expect(phone.getByRole("link", { name: "Overview" })).toBeHidden();
  await menuButton.click();
  await expect(phone.getByRole("link", { name: "Overview" })).toBeVisible();
});

test("linking a repo offers the system's folder dialog, and its checkbox is a checkbox", async ({ page, basis }) => {
  await open(page, basis);
  await page.locator('[class*="projectButton"]').click();
  await page.getByRole("button", { name: /Link product repo/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Browse…" })).toBeVisible();
  await expect(dialog.getByLabel("Repo folder")).toBeVisible();
  const box = await dialog.getByRole("checkbox").boundingBox();
  expect(box?.width).toBeLessThan(24);
  expect(box?.height).toBeLessThan(24);
});

test("the verification kit captures every screen of the views and runs as a static site", async ({ page, basis }) => {
  await open(page, basis);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("tab", { name: "Verification kit" }).click();
  await page.getByRole("button", { name: "Build .zip" }).click();
  await expect(page.getByText(/Captured \d+ shots of \d+ screens/)).toBeVisible({ timeout: 90_000 });
  const response = await page.request.get(`${basis.url}/export/verification-kit.zip`);
  expect(response.ok()).toBe(true);
  const files = unzipSync(new Uint8Array(await response.body()));
  const manifest = JSON.parse(new TextDecoder().decode(files["basis-verify/basis-verify.json"]));
  const shots = manifest.views.flatMap((view: { screens: { shots: { file: string; stable: boolean }[] }[] }) =>
    view.screens.flatMap((screen) => screen.shots),
  );
  expect(shots.length).toBeGreaterThan(0);
  for (const shot of shots) {
    expect(files[`basis-verify/${shot.file}`]?.byteLength).toBeGreaterThan(0);
    expect(shot.stable).toBe(true);
    // Where the media placeholders are, for compare.mjs; the starter view has none.
    const boxes = JSON.parse(
      new TextDecoder().decode(files[`basis-verify/${shot.file.replace(/\.png$/, ".boxes.json")}`]),
    );
    expect(boxes).toEqual({ "[data-basis-media]": [] });
  }
  expect(manifest.media.selector).toBe("[data-basis-media]");
  for (const file of ["design/index.html", "design/design.json", "capture.mjs", "compare.mjs", "README.md"]) {
    expect(files[`basis-verify/${file}`], file).toBeDefined();
  }
  // For the agent that builds it: the prompt, the skill, notes per view and the views' source.
  const text = (file: string) => new TextDecoder().decode(files[`basis-verify/${file}`]);
  expect(manifest.views[0].notes).toBe("views/team-members.md");
  expect(text("PROMPT.md")).toContain("`basis-verify/views/team-members.md`");
  expect(text("SKILL.md")).toMatch(/^---\nname: basis-verify\n/);
  expect(text("views/team-members.md")).toContain('`invite` ("Invite member")');
  expect(text("source/views/TeamMembers.specimen.tsx")).toContain("defineSpecimen");

  // The prompt to copy names the kit's one view, and copying says so at once.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(page.getByLabel("Prompt for the agent")).toContainText("basis-verify/PROMPT.md");
  await expect(page.getByLabel("Prompt for the agent")).toContainText('"Team members" (team-members)');
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("unpacked from the .zip");
});

test("the starter template has no layout findings, and a broken specimen shows each kind", async ({ page, basis }) => {
  // The preview reports its checks to the chrome; keep the latest report.
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "checks") (window as unknown as { checks: unknown }).checks = event.data;
    });
  });
  const settled = async () => {
    await page.waitForFunction(() => {
      const report = (window as unknown as { checks?: { running: boolean } }).checks;
      return report && !report.running;
    });
    return page.evaluate(() => (window as unknown as { checks: { checks: string[] } }).checks.checks);
  };
  await open(page, basis);
  for (const name of ["Design system", "Patterns", "Views"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    // The copy of the preview in the other theme checks every demo at 375px as well.
    await page.waitForTimeout(1500);
    expect((await settled()).filter((check) => check.startsWith("Layout: "))).toEqual([]);
  }

  await page.getByRole("button", { name: "Design system", exact: true }).first().click();
  await writeFile(
    path.join(basis.workspace, "components", "Broken.specimen.tsx"),
    `import { defineSpecimen } from "./specimen.ts";

export default defineSpecimen({
  title: "Broken",
  blocks: [
    { kind: "block", render: () => <div style={{ width: 600, height: 20 }}>Too wide for a phone</div> },
    {
      kind: "block",
      render: () => (
        <button type="button" style={{ width: 60, overflow: "hidden", whiteSpace: "nowrap" }}>
          Save changes
        </button>
      ),
    },
    {
      kind: "block",
      render: () => (
        <div>
          <button type="button" aria-label="One" style={{ width: 12, height: 12, padding: 0 }} />
          <button type="button" aria-label="Two" style={{ width: 12, height: 12, padding: 0 }} />
          <p>Read <a href="#">the guide</a> first.</p>
        </div>
      ),
    },
  ],
});
`,
  );
  await expect
    .poll(async () => (await settled()).filter((check) => check.startsWith("Layout: Broken")).join("\n"))
    .toMatch(/at 375px: content does not fit the frame/);
  const findings = (await settled()).filter((check) => check.startsWith("Layout: Broken")).join("\n");
  expect(findings).toMatch(/text is cut off .* "Save changes"/);
  expect(findings).toMatch(/smaller than 24 by 24px .* aria-label="One"/);
  expect(findings).not.toMatch(/the guide/);
});

test("the project's widths are chosen next to Show at, and a view gets exactly the width shown", async ({
  page,
  basis,
}) => {
  // The preview reports its checks to the chrome; keep the latest report.
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "checks") (window as unknown as { checks: unknown }).checks = event.data;
    });
  });
  const settled = async () => {
    await page.waitForFunction(() => {
      const report = (window as unknown as { checks?: { running: boolean } }).checks;
      return report && !report.running;
    });
    return page.evaluate(() => (window as unknown as { checks: { checks: string[] } }).checks.checks);
  };
  await open(page, basis);
  await page.getByRole("button", { name: "Views", exact: true }).click();
  const frame = gallery(page);
  await frame.getByRole("button", { name: "Mobile", exact: true }).click();
  await frame.getByRole("button", { name: "Fit", exact: true }).click();
  // The screen's own width, inside the frame's padding and the screen's edge.
  const screenWidth = () =>
    frame
      .locator('[data-frame] [class*="flowScreen"]')
      .first()
      .evaluate((element) => element.clientWidth);
  await expect(frame.getByText("Mobile · 375px").first()).toBeVisible();
  expect(await screenWidth()).toBe(375);

  const control = frame.getByRole("button", { name: /^The project's widths: Mobile 375, Tablet 768, Desktop 1440/ });
  await control.click();
  const mobile = frame.getByRole("spinbutton", { name: "Mobile" });
  // A width out of range, or not narrower than the next, is refused with the reason.
  await mobile.fill("250");
  await mobile.press("Enter");
  await expect(frame.locator("#basis-widths").getByRole("status")).toHaveText(
    "Mobile must be a whole number from 280 to 3840px.",
  );
  await mobile.fill("900");
  await mobile.press("Enter");
  await expect(frame.locator("#basis-widths").getByRole("status")).toHaveText("Mobile must be narrower than Tablet.");
  expect(await screenWidth()).toBe(375);

  await mobile.fill("390");
  await mobile.press("Enter");
  await expect(frame.getByText("Mobile · 390px").first()).toBeVisible();
  expect(await screenWidth()).toBe(390);
  expect(JSON.parse(await readFile(path.join(basis.workspace, ".basis", "widths.json"), "utf8"))).toEqual({
    mobile: 390,
    tablet: 768,
    desktop: 1440,
  });

  // The layout check measures at the new width: a demo 400px wide fits no longer, and 375 is not checked.
  await page.getByRole("button", { name: "Design system", exact: true }).first().click();
  await writeFile(
    path.join(basis.workspace, "components", "Wide.specimen.tsx"),
    `import { defineSpecimen } from "./specimen.ts";

export default defineSpecimen({
  title: "Wide",
  blocks: [{ kind: "block", render: () => <div style={{ width: 400, height: 20 }}>Wider than 390</div> }],
});
`,
  );
  await expect
    .poll(async () => (await settled()).filter((check) => check.startsWith("Layout: Wide")).join("\n"))
    .toMatch(/at 390px: content does not fit the frame/);
  expect((await settled()).filter((check) => check.includes("at 375px"))).toEqual([]);

  // The kit's shots of a flow without its own capture widths are the project's.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("tab", { name: "Verification kit" }).click();
  await page.getByRole("button", { name: "Build .zip" }).click();
  await expect(page.getByText(/Captured \d+ shots of \d+ screens/)).toBeVisible({ timeout: 90_000 });
  const response = await page.request.get(`${basis.url}/export/verification-kit.zip`);
  const files = unzipSync(new Uint8Array(await response.body()));
  const manifest = JSON.parse(new TextDecoder().decode(files["basis-verify/basis-verify.json"]));
  for (const screen of manifest.views[0].screens as { shots: { width: number }[] }[]) {
    expect(screen.shots.map((shot) => shot.width)).toEqual([390, 768, 1440]);
  }

  // They are the project's: a reload keeps them, and Reset goes back to Basis' own.
  await page.reload();
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await expect(frame.getByText("Mobile · 390px").first()).toBeVisible();
  await frame.getByRole("button", { name: /^The project's widths: Mobile 390/ }).click();
  await frame.getByRole("button", { name: "Reset to 375, 768, 1440" }).click();
  await expect(frame.getByText("Mobile · 375px").first()).toBeVisible();
  expect(await screenWidth()).toBe(375);
});
