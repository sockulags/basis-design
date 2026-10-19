import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, expect, type FrameLocator, type Page } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..", "..");

export interface Basis {
  url: string;
  /** The throwaway workspace this instance opened (with `home`, its first project's). */
  workspace: string;
  /** The value of a token in the workspace's design-system.json, by dotted path. */
  token(dotted: string): Promise<string>;
}

/**
 * Every test gets its own Basis: a throwaway workspace, its own ports, and the stand-in agent
 * (fake-agent.mjs), so the server, the history, the checks and the gallery all run for real. With `home`
 * (`test.use({ home: true })`) it gets a throwaway home of its own instead, so projects can be created.
 */
export const test = base.extend<{ basis: Basis; home: boolean }>({
  home: [false, { option: true }],
  basis: async ({ home }, provide, testInfo) => {
    const folder = await mkdtemp(path.join(tmpdir(), "basis-e2e-"));
    // A new home starts with a project called Basis in its workspaces/ folder.
    const workspace = home ? path.join(folder, "workspaces", "basis") : folder;
    const port = 5400 + testInfo.workerIndex * 2;
    const proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        ...(home ? { BASIS_HOME: folder } : { BASIS_WORKSPACE: folder }),
        BASIS_AGENT_SCRIPT: path.join(root, "test", "e2e", "fake-agent.mjs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let log = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Basis did not start:\n${log}`)), 90_000);
      const read = (chunk: Buffer) => {
        log += chunk.toString("utf8");
        if (log.includes("Basis is running at")) {
          clearTimeout(timer);
          resolve();
        }
      };
      proc.stdout.on("data", read);
      proc.stderr.on("data", read);
      proc.on("exit", (code) => reject(new Error(`Basis exited (${code}):\n${log}`)));
    });
    const token = async (dotted: string) => {
      const design = JSON.parse(await readFile(path.join(workspace, "design-system.json"), "utf8"));
      return dotted.split(".").reduce((value, key) => value?.[key], design) as string;
    };
    try {
      await provide({ url: `http://localhost:${port}`, workspace, token });
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach("server log", { body: log });
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
      else process.kill(-proc.pid!, "SIGTERM");
      await new Promise((resolve) => (proc.exitCode !== null ? resolve(null) : proc.once("exit", resolve)));
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
});

export { expect };

/** The sandboxed gallery. */
export function gallery(page: Page): FrameLocator {
  return page.frameLocator('iframe[src*="preview.html"]');
}

/** Opens Basis and waits for the agent to be ready. */
export async function open(page: Page, basis: Basis): Promise<void> {
  await page.goto(basis.url);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
}

/** Sends a prompt to the stand-in agent and waits until its turn is recorded. */
export async function prompt(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(/Describe a change/).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Fast motion is now/).last()).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
}

/** The number in the History button ("History · 2"). */
export async function historyCount(page: Page): Promise<number> {
  const label = await page.getByRole("button", { name: /^History/ }).textContent();
  return Number(label?.match(/\d+/)?.[0] ?? 0);
}
