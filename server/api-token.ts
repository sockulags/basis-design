import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** The file in BASIS_HOME that holds the API token Basis made for itself (read by the MCP server, mcp/). */
export const TOKEN_FILE = "api-token";

/**
 * The API token when BASIS_API_TOKEN is not set and Basis listens only on loopback: the one in
 * `<home>/api-token`, made the first time, so tools on this machine (the MCP server, scripts) find the API on
 * without setup. Only the user can read the file. Basis listening beyond loopback never makes one: there the
 * API stays off unless BASIS_API_TOKEN is set.
 */
export async function localApiToken(home: string): Promise<string> {
  const file = path.join(home, TOKEN_FILE);
  const existing = (await readFile(file, "utf8").catch(() => "")).trim();
  if (existing.length >= 32) return existing;
  const token = randomBytes(24).toString("hex");
  await mkdir(home, { recursive: true });
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  // writeFile keeps the mode of a file that was there; make sure.
  await chmod(file, 0o600).catch(() => undefined);
  return token;
}
