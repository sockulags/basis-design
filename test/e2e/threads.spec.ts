import type { Page } from "@playwright/test";
import { expect, open, test } from "./basis.ts";

const threadButton = (page: Page) => page.locator('[class*="threadButton"]');
const conversation = (page: Page) => page.getByRole("region", { name: "Conversation" });

async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(/Describe a change|Type the next step/).fill(text);
  await page.getByRole("button", { name: /^(Send|Queue)$/ }).click();
}

/** The row of a thread in the open thread list. */
const row = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(`^${title}`) });

test("threads are separate chats whose turns take turns", async ({ page, basis }) => {
  await open(page, basis);
  // The first chat's turn waits for an approval, so it holds the agent until it is answered.
  await send(page, "E2E-ASK in the first chat");
  await expect(page.getByText("Run the E2E command")).toBeVisible();
  await expect(threadButton(page)).toContainText("E2E-ASK in the first chat");

  // A second chat meanwhile: its message waits in the queue.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(conversation(page).getByText("E2E-ASK in the first chat")).toHaveCount(0);
  await send(page, "E2E-WHO in the second chat");
  await expect(page.getByText("Queued · runs when the agent is done")).toBeVisible();
  await expect(threadButton(page)).toContainText("is waiting for approval");
  await threadButton(page).click();
  await expect(row(page, "E2E-ASK in the first chat")).toContainText("waiting for approval");
  await expect(row(page, "E2E-WHO in the second chat")).toContainText("queued");

  // Answered in the first chat; then the second one's turn runs, in a session of its own.
  await row(page, "E2E-ASK in the first chat").click();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(conversation(page).getByText(/Fast motion is now/)).toHaveCount(1);
  await expect(conversation(page).getByText("E2E-WHO in the second chat")).toHaveCount(0);
  await threadButton(page).click();
  await row(page, "E2E-WHO in the second chat").click();
  await expect(conversation(page).getByText(/Session \S+ new\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(conversation(page).getByText(/Fast motion is now/)).toHaveCount(1);
  await expect(conversation(page).getByText("E2E-ASK in the first chat")).toHaveCount(0);

  // Each agent change in history names the chat it came from.
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByRole("menuitem").filter({ hasText: "in “E2E-ASK in the first chat”" })).toHaveCount(1);
  await expect(page.getByRole("menuitem").filter({ hasText: "in “E2E-WHO in the second chat”" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // A new tab shows the chat shown last, and a chat no tab shows can be removed.
  await page.reload();
  await expect(threadButton(page)).toContainText("E2E-WHO in the second chat");
  await threadButton(page).click();
  await page.getByRole("button", { name: "Remove E2E-ASK in the first chat", exact: true }).click();
  await page.getByRole("button", { name: "Remove E2E-ASK in the first chat for good" }).click();
  await expect(row(page, "E2E-ASK in the first chat")).toHaveCount(0);
  await expect(row(page, "E2E-WHO in the second chat")).toBeVisible();
});
