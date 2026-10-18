import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Basis runs the user's own Claude Code rather than a copy of its own: the Claude adapter is fetched without the
 * native binary its SDK would otherwise bring (about 260 MB), and is pointed at the user's executable through
 * CLAUDE_CODE_EXECUTABLE. The user already has it, logged in, since that is how they sign in to Claude.
 */

interface Where {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
}

const isFile = (file: string) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * The user's Claude Code executable, or null when it is not installed. In order: CLAUDE_CODE_EXECUTABLE when it
 * names a file, `claude` on the PATH, then the native installer's folders. On Windows the npm install puts a
 * `claude.cmd` shim on the PATH, which cannot be started without a shell, so the executable behind it is used.
 */
export function findClaude(
  { env, platform, home }: Where = { env: process.env, platform: process.platform, home: os.homedir() },
): string | null {
  const explicit = env.CLAUDE_CODE_EXECUTABLE;
  if (explicit && isFile(explicit)) return explicit;

  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const pathVar = env.PATH ?? env.Path ?? "";
  const dirs = pathVar.split(windows ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    if (windows) {
      const exe = join(dir, "claude.exe");
      if (isFile(exe)) return exe;
      // The npm shims (claude, claude.cmd) start this executable.
      const npm = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      if ((isFile(join(dir, "claude.cmd")) || isFile(join(dir, "claude"))) && isFile(npm)) return npm;
    } else {
      const bin = join(dir, "claude");
      if (isFile(bin)) return realpath(bin);
    }
  }

  const installed = windows
    ? [join(home, ".local", "bin", "claude.exe")]
    : [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude")];
  for (const file of installed) if (isFile(file)) return windows ? file : realpath(file);
  return null;
}

/** Symlinks (the native installer links to a versioned binary) resolved, so the agent starts the binary itself. */
function realpath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** What the user is told when Basis cannot find Claude Code. */
export const CLAUDE_MISSING =
  "Basis runs your own Claude Code, and it is not installed. Install it (https://claude.com/claude-code), log in once with `claude` in a terminal, then pick Claude again. If it is installed, set CLAUDE_CODE_EXECUTABLE to its path.";
