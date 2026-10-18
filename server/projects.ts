import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DESIGN, parseDesignText } from "../shared/design.ts";
import type { ProjectEntry } from "../shared/protocol.ts";
import { slug } from "./export.ts";
import { DESIGN_FILE, SOURCE_DIRS } from "./paths.ts";

/*
 * The list of projects. A project is a workspace folder: its own design
 * system, history, chat and review. New projects live in <home>/workspaces/,
 * and a folder anywhere else (inside a product repo, say) can be opened too.
 * Removing a project from the list never deletes its folder.
 */

const FILE = "basis.projects.json";

interface Saved {
  active: string;
  projects: ProjectEntry[];
}

export class Projects {
  private saved: Saved = { active: "", projects: [] };
  private readonly file: string;
  /** False for a one-off run of a single workspace (see load). */
  private persist = true;

  /** `home` holds the list and the folders of new projects. */
  constructor(private readonly home: string) {
    this.file = path.join(home, FILE);
  }

  /**
   * Reads the list; `fallback` (the workspace of older Basis versions) is the
   * first project of a new one. `only` (BASIS_WORKSPACE) instead opens that one
   * workspace for this run: the list holds just it and nothing is saved, so a
   * one-off or test instance never changes which project Basis opens next time.
   */
  async load({ only, fallback }: { only?: string; fallback?: string } = {}): Promise<void> {
    if (only) {
      const dir = path.resolve(only);
      const name = await designName(dir);
      this.persist = false;
      this.saved = { active: slug(name), projects: [{ id: slug(name), name, dir }] };
      return;
    }
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Saved>;
      const projects = Array.isArray(raw.projects)
        ? raw.projects.filter((entry): entry is ProjectEntry => Boolean(entry?.id && entry.name && entry.dir))
        : [];
      this.saved = { active: typeof raw.active === "string" ? raw.active : "", projects };
    } catch {
      this.saved = { active: "", projects: [] };
    }
    if (this.saved.projects.length === 0 && fallback) {
      const dir = path.resolve(fallback);
      this.saved.active = (await this.add(await designName(dir), dir)).id;
    }
    if (!this.saved.projects.some((entry) => entry.id === this.saved.active)) {
      this.saved.active = this.saved.projects[0]?.id ?? "";
    }
    await this.save();
  }

  get list(): ProjectEntry[] {
    return this.saved.projects;
  }

  get active(): ProjectEntry | undefined {
    return this.saved.projects.find((entry) => entry.id === this.saved.active);
  }

  find(id: string): ProjectEntry | undefined {
    return this.saved.projects.find((entry) => entry.id === id);
  }

  async setActive(id: string): Promise<void> {
    if (!this.find(id)) return;
    this.saved.active = id;
    await this.save();
  }

  /**
   * Creates a project in <home>/workspaces/. It starts from Basis' defaults, or
   * as a copy of another project's design system (tokens and source, not its
   * history, chat or review). Either way the design system takes the new name.
   */
  async create(name: string, from?: ProjectEntry): Promise<ProjectEntry> {
    const title = name.trim().slice(0, 80) || "Untitled";
    const dir = await freeFolder(path.join(this.home, "workspaces"), slug(title));
    await mkdir(dir, { recursive: true });
    let design: unknown = DEFAULT_DESIGN;
    if (from) {
      for (const folder of SOURCE_DIRS) {
        const source = path.join(from.dir, folder);
        if (existsSync(source)) await cp(source, path.join(dir, folder), { recursive: true });
      }
      const copied = parseDesignText(await readFile(path.join(from.dir, DESIGN_FILE), "utf8").catch(() => ""));
      if (copied.ok) design = copied.design;
    }
    await writeFile(
      path.join(dir, DESIGN_FILE),
      `${JSON.stringify({ ...(design as object), name: title }, null, 2)}\n`,
    );
    return this.add(title, dir);
  }

  /**
   * Adds an existing folder. It must be a Basis workspace, or empty, or not
   * exist yet (then Basis sets it up). Anything else is refused: Basis would
   * otherwise start a git history in someone's project and commit their files.
   */
  async open(folder: string): Promise<ProjectEntry> {
    const dir = path.resolve(folder.trim());
    if (!folder.trim() || !path.isAbsolute(folder.trim())) throw new Error("Give the full path of a folder.");
    const known = this.saved.projects.find((entry) => samePath(entry.dir, dir));
    if (known) return known;
    if (existsSync(dir)) {
      if (!(await stat(dir)).isDirectory()) throw new Error("That path is a file, not a folder.");
      const isWorkspace = existsSync(path.join(dir, DESIGN_FILE));
      if (!isWorkspace && (await readdir(dir)).length > 0) {
        throw new Error(
          "That folder has files but is not a Basis workspace. Pick an empty folder, or a new folder inside it (Basis creates it).",
        );
      }
    }
    await mkdir(dir, { recursive: true });
    return this.add(await designName(dir), dir);
  }

  /**
   * Links a product repo to a project, or unlinks it with null. The repo must be
   * an existing folder outside the workspace; Basis only reads it.
   */
  async setRepo(id: string, folder: string | null): Promise<ProjectEntry> {
    const entry = this.find(id);
    if (!entry) throw new Error("There is no such project.");
    let repo: string | undefined;
    if (folder !== null) {
      repo = await checkRepo(folder);
      if (samePath(repo, entry.dir) || isInside(entry.dir, repo)) {
        throw new Error("That is the project's own workspace; link the product repo it designs for.");
      }
    }
    const updated: ProjectEntry = { id: entry.id, name: entry.name, dir: entry.dir, ...(repo ? { repo } : {}) };
    this.saved.projects = this.saved.projects.map((item) => (item.id === id ? updated : item));
    await this.save();
    return updated;
  }

  /** Takes a project off the list; its folder stays. The active project cannot be removed. */
  async remove(id: string): Promise<void> {
    if (id === this.saved.active) return;
    this.saved.projects = this.saved.projects.filter((entry) => entry.id !== id);
    await this.save();
  }

  private async add(name: string, dir: string): Promise<ProjectEntry> {
    let id = slug(name);
    for (let n = 2; this.find(id); n++) id = `${slug(name)}-${n}`;
    const entry = { id, name, dir };
    this.saved.projects = [...this.saved.projects, entry];
    await this.save();
    return entry;
  }

  private async save(): Promise<void> {
    if (!this.persist) return;
    await mkdir(this.home, { recursive: true });
    await writeFile(this.file, `${JSON.stringify(this.saved, null, 2)}\n`);
  }
}

/** The design system's name in a workspace folder, or the folder's name when it has none yet. */
async function designName(dir: string): Promise<string> {
  const design = parseDesignText(await readFile(path.join(dir, DESIGN_FILE), "utf8").catch(() => ""));
  return design.ok ? design.design.name : path.basename(dir);
}

/** `<parent>/<name>`, or `<name>-2`, `-3` ... when that folder already exists. */
async function freeFolder(parent: string, name: string): Promise<string> {
  let dir = path.join(parent, name);
  for (let n = 2; existsSync(dir); n++) dir = path.join(parent, `${name}-${n}`);
  return dir;
}

/** The absolute path of a repo folder the user gave, or an error saying what is wrong with it. */
export async function checkRepo(folder: string): Promise<string> {
  const trimmed = folder.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) throw new Error("Give the full path of the repo's folder.");
  const repo = path.resolve(trimmed);
  if (!existsSync(repo) || !(await stat(repo)).isDirectory()) throw new Error("That folder does not exist.");
  return repo;
}

/** True when `target` lies inside `dir` (not `dir` itself). */
function isInside(dir: string, target: string): boolean {
  const relative = path.relative(dir, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(a: string, b: string): boolean {
  const normal = (value: string) => path.resolve(value).toLowerCase();
  return process.platform === "win32" ? normal(a) === normal(b) : path.resolve(a) === path.resolve(b);
}
