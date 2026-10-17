import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

/** Runs git in `cwd` as Basis, so commits never depend on the user's git identity. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run(
    "git",
    [
      "-c",
      "user.name=Basis",
      "-c",
      "user.email=basis@localhost",
      "-c",
      "core.autocrlf=false",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd,
  );
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

/** True when `id` is a full commit id that exists in the repository at `cwd`. */
export async function isCommit(cwd: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{40}$/.test(id)) return false;
  return git(cwd, ["cat-file", "-e", `${id}^{commit}`]).then(
    () => true,
    () => false,
  );
}

/** Lines of git output that are not empty, such as the names from `diff --name-only`. */
export function lines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}

function tscEntry(): string {
  const pkgPath = require.resolve("typescript/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: Record<string, string> };
  return path.join(path.dirname(pkgPath), pkg.bin.tsc ?? "bin/tsc");
}

/** Type-checks a project and returns its diagnostics as single-line strings, paths relative to the project. */
export async function typecheck(projectDir: string): Promise<string[]> {
  const result = await run(
    process.execPath,
    [tscEntry(), "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
    projectDir,
  );
  if (result.code === 0) return [];
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /error TS\d+/.test(line));
  return lines.length ? lines : [result.stdout.trim() || result.stderr.trim() || "Type check failed"];
}
