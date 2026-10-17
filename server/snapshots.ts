import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDesignText, type Design } from "../shared/design.ts";
import { git, isCommit } from "./exec.ts";
import { DESIGN_FILE, SOURCE_DIRS } from "./paths.ts";

/**
 * Read-only copies of past versions under .basis/snapshots/<commit>/, which
 * the preview imports so a review's "before" side runs that version's own
 * component code next to today's.
 */
export class Snapshots {
  private readonly root: string;
  /** Copies being written, so concurrent requests for one version share the work. */
  private pending = new Map<string, Promise<string>>();

  constructor(private readonly dir: string) {
    this.root = path.join(dir, ".basis", "snapshots");
  }

  /** A past version: its tokens, and the folder holding a copy of its source. */
  async get(id: string): Promise<{ id: string; design: Design; dir: string } | null> {
    if (!(await isCommit(this.dir, id))) return null;
    try {
      const result = parseDesignText(await git(this.dir, ["show", `${id}:${DESIGN_FILE}`]));
      if (!result.ok) return null;
      return { id, design: result.design, dir: await this.materialise(id) };
    } catch {
      return null;
    }
  }

  /** Removes every copy except `keep`'s. */
  async prune(keep: string | undefined): Promise<void> {
    if (!existsSync(this.root)) return;
    for (const name of await readdir(this.root)) {
      if (name !== keep) await rm(path.join(this.root, name), { recursive: true, force: true });
    }
  }

  /** Writes the source folders of a commit once; later calls reuse the copy. */
  private materialise(id: string): Promise<string> {
    const running = this.pending.get(id);
    if (running) return running;
    const target = path.join(this.root, id);
    const done = path.join(target, ".complete");
    const work = (async () => {
      if (existsSync(done)) return target;
      await rm(target, { recursive: true, force: true });
      const names = (await git(this.dir, ["ls-tree", "-r", "-z", "--name-only", id, "--", ...SOURCE_DIRS]))
        .split("\0")
        .filter(Boolean);
      await Promise.all(
        names.map(async (name) => {
          const file = path.join(target, ...name.split("/"));
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, await git(this.dir, ["show", `${id}:${name}`]));
        }),
      );
      await writeFile(done, "");
      return target;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return work;
  }
}
