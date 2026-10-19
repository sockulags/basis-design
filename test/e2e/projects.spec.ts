import type { Page } from "@playwright/test";
import { expect, historyCount, open, test } from "./basis.ts";

test.use({ home: true });

const projectButton = (page: Page) => page.locator('[class*="projectButton"]');

/** Opens the project menu and switches to the project called `name`. */
async function switchTo(page: Page, name: string): Promise<void> {
  await projectButton(page).click();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.locator('[class*="projectName"]')).toHaveText(name);
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(/Describe a change/).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("two projects run turns at the same time, each into its own chat and history", async ({ page, basis }) => {
  await open(page, basis);
  const before = await historyCount(page);
  await projectButton(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  await page.getByLabel("Name").fill("Second");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator('[class*="projectName"]')).toHaveText("Second");
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  // A slow turn in Second, and while it runs, a turn in Basis.
  await send(page, "E2E-SLOW in the second project");
  await expect(page.getByText("Working", { exact: true })).toBeVisible();
  await switchTo(page, "Basis");
  await projectButton(page).click();
  await expect(page.getByRole("button", { name: /^Second/ })).toContainText("working");
  await page.keyboard.press("Escape");
  await send(page, "E2E-SLOW in the first project");
  await expect(page.getByText(/Fast motion is now/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect.poll(() => historyCount(page)).toBe(before + 1);
  await expect(page.getByText("E2E-SLOW in the second project")).toHaveCount(0);

  // Second finished in the background: the button says so with the menu shut.
  await expect(projectButton(page)).toContainText("Second finished in the background");
  await switchTo(page, "Second");
  await expect(page.getByText("E2E-SLOW in the second project")).toBeVisible();
  await expect(page.getByText("E2E-SLOW in the first project")).toHaveCount(0);
  await expect(page.getByText(/Fast motion is now/)).toHaveCount(1);
  await expect.poll(() => historyCount(page)).toBe(before + 1);
  await expect(projectButton(page)).not.toContainText("finished in the background");
});

test("a project waiting for an approval in the background shows outside the menu", async ({ page, basis }) => {
  await open(page, basis);
  await projectButton(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  await page.getByLabel("Name").fill("Asking");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator('[class*="projectName"]')).toHaveText("Asking");
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await send(page, "E2E-ASK run something");
  await expect(page.getByText("Run the E2E command")).toBeVisible();

  await switchTo(page, "Basis");
  await expect(projectButton(page)).toContainText("Asking is waiting for approval");
  await projectButton(page).click();
  await expect(page.getByRole("button", { name: /^Asking/ })).toContainText("waiting for approval");
  await page.getByRole("button", { name: /^Asking/ }).click();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByText(/Fast motion is now/)).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
});
