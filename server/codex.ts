import { linkSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Codex loads the user's own setup from its home folder (CODEX_HOME, ~/.codex): their AGENTS.md, config (model,
 * sandbox and approval choices, developer instructions, MCP servers, plugins), skills, hooks, rules that allow
 * commands, and memories. That is meant for their coding, not for designing in Basis, and the rules and hooks
 * would act without Basis' approval. No setting turns off the home's AGENTS.md, so Codex runs in a home of
 * Basis' own, which shares only the user's login: its auth.json is a link to the user's, so a token Codex
 * refreshes in one is refreshed in both, and no copy of the credentials is made.
 */

/**
 * Codex config for every session (the adapter merges CODEX_CONFIG into each one), for what lives outside the home
 * or comes with the login: skills in ~/.agents/skills, the bundled skills, the account's apps (connectors) and
 * plugins, memories and hooks. Basis' own MCP server is passed per session and is not affected.
 *
 * No Windows sandbox is chosen, so on Windows Codex asks before every command, reads included: the elevated
 * sandbox is set up per home with an administrator prompt, and the unelevated one cannot start PowerShell when it
 * comes from the Microsoft Store.
 */
export const CODEX_SETTINGS = {
  skills: { include_instructions: false, bundled: { enabled: false } },
  features: { apps: false, plugins: false, memories: false, hooks: false },
};

interface Where {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
}

/**
 * The variables Codex starts with: Basis' settings, and CODEX_HOME set to `<basisHome>/codex` when the user's login
 * could be shared with it. Without a login file to link (no login yet, or one kept in the system keyring), Codex
 * runs in the user's own home with the settings only, so the login keeps working.
 */
export function codexEnv(
  basisHome: string,
  { env, platform, home }: Where = { env: process.env, platform: process.platform, home: os.homedir() },
): Record<string, string> {
  const settings = { CODEX_CONFIG: JSON.stringify(CODEX_SETTINGS) };
  const own = path.join(basisHome, "codex");
  const user = path.resolve(env.CODEX_HOME || path.join(home, ".codex"));
  if (path.relative(user, own) === "") return settings;
  return shareLogin(user, own, platform) ? { ...settings, CODEX_HOME: own } : settings;
}

/**
 * Links `own`/auth.json to the user's login file, renewed on every start, and says whether it worked. A symlink
 * where the system allows one; on Windows, which needs developer mode for those, a hard link (the same file under
 * a second name), which stays the same file because Codex rewrites auth.json in place.
 */
export function shareLogin(user: string, own: string, platform: NodeJS.Platform = process.platform): boolean {
  const login = path.join(user, "auth.json");
  const link = path.join(own, "auth.json");
  try {
    mkdirSync(own, { recursive: true });
    // An old link goes first: after a logout it would keep the login the user removed.
    rmSync(link, { force: true });
  } catch {
    return false;
  }
  if (!isFile(login)) return false;
  try {
    symlinkSync(login, link, "file");
    return true;
  } catch {
    // Falls through to a hard link on Windows.
  }
  if (platform !== "win32") return false;
  try {
    linkSync(login, link);
    return true;
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
