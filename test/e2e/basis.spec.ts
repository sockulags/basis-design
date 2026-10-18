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
