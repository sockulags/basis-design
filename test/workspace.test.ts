import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { WORKSPACE_FORMAT } from "../server/setup.ts";
import { earlierTemplateHashes, TEMPLATE_VERSION, templateChanges } from "../server/template.ts";
import { Workspace } from "../server/workspace.ts";

/*
 * The workspace's git handling end to end, in throwaway folders: history
 * entries, reviews (iterations, approve, discard, going back, restarts) and
 * migrations. The type check is stubbed out; it is slow and not what these
 * tests are about.
 */

const open: Workspace[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const workspace of open.splice(0)) await workspace.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "basis-test-"));
  folders.push(dir);
  return dir;
}

async function start(dir: string): Promise<Workspace> {
  const workspace = new Workspace(dir, { typecheck: async () => [] });
  await workspace.init();
  open.push(workspace);
  return workspace;
}

/** Runs `edit` as an agent turn, the way AgentHost does. */
async function turn(workspace: Workspace, label: string, edit: () => Promise<void>): Promise<void> {
  await workspace.beginTurn(label);
  await edit();
  await workspace.endTurn();
}

async function setToken(dir: string, value: string): Promise<void> {
  const file = path.join(dir, "design-system.json");
  const design = JSON.parse(await readFile(file, "utf8"));
  design.color.light.primary = value;
  await writeFile(file, `${JSON.stringify(design, null, 2)}\n`);
}

async function token(dir: string): Promise<string> {
  return JSON.parse(await readFile(path.join(dir, "design-system.json"), "utf8")).color.light.primary;
}

const request = (title: string) => JSON.stringify({ title, show: [{ specimen: "Buttons", rows: ["primary"] }] });
const openReview = (dir: string, title = "Softer primary") => writeFile(path.join(dir, "review.json"), request(title));
const git = (dir: string, args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

describe("history", () => {
  test("a new workspace is seeded and starts with one entry", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    assert.ok(existsSync(path.join(dir, "components", "Button.tsx")));
    assert.ok(existsSync(path.join(dir, "patterns", "Navbar.tsx")));
    assert.ok(existsSync(path.join(dir, "components", "contracts.ts")));
    assert.ok(existsSync(path.join(dir, "views", "TeamMembers.specimen.tsx")));
    assert.ok(existsSync(path.join(dir, ".basis", "guidelines.md")));
    assert.deepEqual(
      workspace.entries.map((entry) => entry.source),
      ["init"],
    );
  });

  test("a turn becomes one entry with its label and changed tokens", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "Warmer primary", () => setToken(dir, "#c2410c"));
    const last = workspace.entries.at(-1);
    assert.equal(workspace.entries.length, 2);
    assert.equal(last?.source, "agent");
    assert.equal(last?.label, "Warmer primary");
    assert.deepEqual(last?.changed, ["color.light.primary"]);
  });

  test("a turn reports colours that ignore the theme, in tokens and stylesheets", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    assert.deepEqual(workspace.state.colorFindings, []);
    await turn(workspace, "White sheen", async () => {
      const css = path.join(dir, "components", "Button.module.css");
      await writeFile(
        css,
        `${await readFile(css, "utf8")}\n.sheen { background: linear-gradient(white, transparent); }\n`,
      );
      const file = path.join(dir, "design-system.json");
      const design = JSON.parse(await readFile(file, "utf8"));
      design.shadow.md = "0 4px 12px rgb(15 27 45 / 0.06)";
      await writeFile(file, `${JSON.stringify(design, null, 2)}\n`);
    });
    assert.deepEqual(workspace.state.colorFindings, [
      "design-system.json shadow.md uses the fixed colour rgb(15 27 45 / 0.06)",
      "components/Button.module.css uses the fixed colour white",
    ]);
  });

  test("a turn that starts while a hand edit is still checked keeps its own changes", async () => {
    const dir = await folder();
    let slow = false;
    const workspace = new Workspace(dir, {
      typecheck: async () => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 600));
        return [];
      },
    });
    await workspace.init();
    open.push(workspace);
    slow = true;
    await setToken(dir, "#123456");
    // The hand edit settles after 900 ms, and its check then takes 600 ms: the turn starts in the middle.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await turn(workspace, "Agent", () => setToken(dir, "#654321"));
    assert.deepEqual(
      workspace.entries.map((entry) => entry.source),
      ["init", "external", "agent"],
    );
  });

  test("a turn that changes nothing adds no entry", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "Just looking", async () => {});
    assert.equal(workspace.entries.length, 1);
  });

  test("an untouched earlier specimen format is updated, a changed one is left alone", async () => {
    const earlier = execFileSync("git", ["show", "ff623a8:template/components/specimen.ts"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    const untouched = await folder();
    await (await start(untouched)).close();
    await writeFile(path.join(untouched, "components", "specimen.ts"), earlier);
    // An older workspace has the earlier format in its history too.
    git(untouched, ["add", "-A"]);
    git(untouched, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older format"]);
    const updated = await start(untouched);
    assert.match(await readFile(path.join(untouched, "components", "specimen.ts"), "utf8"), /kind: "states"/);
    assert.equal(updated.entries.at(-1)?.label, "Basis updated components/specimen.ts");

    const changed = await folder();
    await (await start(changed)).close();
    await writeFile(path.join(changed, "components", "specimen.ts"), `${earlier}\n// my own helper\n`);
    await start(changed);
    assert.doesNotMatch(await readFile(path.join(changed, "components", "specimen.ts"), "utf8"), /kind: "states"/);
  });

  test("an older workspace gets the files Basis added since", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    // A workspace from before contracts.ts existed: the file is not in its history either.
    git(dir, ["rm", "-q", "components/contracts.ts"]);
    git(dir, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older workspace"]);
    const workspace = await start(dir);
    assert.ok(existsSync(path.join(dir, "components", "contracts.ts")));
    assert.equal(workspace.entries.at(-1)?.label, "Basis added component contracts");
    assert.equal(workspace.entries.at(-1)?.source, "upgrade");
  });

  test("a workspace a newer Basis has opened is refused, and left as it was", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    const format = path.join(dir, ".basis", "format.json");
    await writeFile(format, JSON.stringify({ format: WORKSPACE_FORMAT + 1 }));
    await assert.rejects(start(dir), /newer version of Basis/);
    assert.equal(JSON.parse(await readFile(format, "utf8")).format, WORKSPACE_FORMAT + 1);
  });
});

describe("pattern contracts", () => {
  test("an older workspace with patterns gets patterns/contracts.ts", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    git(dir, ["rm", "-q", "patterns/contracts.ts"]);
    git(dir, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older workspace"]);
    const workspace = await start(dir);
    assert.ok(existsSync(path.join(dir, "patterns", "contracts.ts")));
    assert.ok(existsSync(path.join(dir, ".basis", "pattern-contracts.ts")));
    assert.equal(workspace.entries.at(-1)?.label, "Basis added pattern contracts");
  });

  test("an older workspace gets the starter patterns added since, with their exports", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    const index = path.join(dir, "patterns", "index.ts");
    for (const name of ["Composer", "Chat"]) {
      git(dir, ["rm", "-q", `patterns/${name}.tsx`, `patterns/${name}.module.css`, `patterns/${name}.specimen.tsx`]);
      await writeFile(index, (await readFile(index, "utf8")).replace(`export * from "./${name}.tsx";\n`, ""));
    }
    git(dir, ["add", "patterns/index.ts"]);
    git(dir, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older workspace"]);
    const workspace = await start(dir);
    const exports = await readFile(index, "utf8");
    for (const name of ["Composer", "Chat"]) {
      assert.ok(existsSync(path.join(dir, "patterns", `${name}.specimen.tsx`)));
      assert.equal(exports.split(`"./${name}.tsx"`).length, 2);
    }
    assert.equal(workspace.entries.at(-1)?.label, "Basis added the Composer and Chat patterns");
    // A workspace that has them is left alone.
    await workspace.close();
    const entries = (await start(dir)).entries.length;
    assert.equal(entries, workspace.entries.length);
  });
});

describe("template updates", () => {
  const basis = path.resolve(import.meta.dirname, "..");
  /** A starter file as an earlier commit of Basis had it. */
  const earlier = (commit: string, file: string) =>
    execFileSync("git", ["show", `${commit}:template/${file}`], { cwd: basis, encoding: "utf8" });

  test("a starter file nobody changed follows the template; a changed one is left for the agent", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    // An older workspace: one untouched earlier version, one the agent changed, no recorded template version.
    await writeFile(
      path.join(dir, "components", "Button.module.css"),
      earlier("91f8516", "components/Button.module.css"),
    );
    const changed = `${earlier("91f8516", "components/Tabs.module.css")}\n.mine { color: red; }\n`;
    await writeFile(path.join(dir, "components", "Tabs.module.css"), changed);
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older workspace"]);
    await rm(path.join(dir, ".basis", "template.json"));

    const workspace = await start(dir);
    const template = await readFile(path.join(basis, "template", "components", "Button.module.css"), "utf8");
    assert.equal(
      await readFile(path.join(dir, "components", "Button.module.css"), "utf8"),
      template.replaceAll("\r\n", "\n"),
    );
    assert.equal(workspace.entries.at(-1)?.source, "upgrade");
    assert.match(workspace.entries.at(-1)?.label ?? "", /^Basis updated/);
    assert.equal(await readFile(path.join(dir, "components", "Tabs.module.css"), "utf8"), changed);

    const update = workspace.state.templateUpdate;
    assert.deepEqual(update?.files, ["components/Tabs.module.css"]);
    assert.equal(update?.to, TEMPLATE_VERSION);
    // The agent compares against a copy of the template inside the workspace.
    assert.ok(existsSync(path.join(dir, ".basis", "template", "components", "Tabs.module.css")));
  });

  test("a component's files are updated together: one changed file keeps its untouched siblings as they were", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    const source = earlier("0772414", "patterns/Navbar.tsx");
    await writeFile(path.join(dir, "patterns", "Navbar.tsx"), source);
    const styles = earlier("0772414", "patterns/Navbar.module.css").replace("height: 60px;", "height: 64px;");
    await writeFile(path.join(dir, "patterns", "Navbar.module.css"), styles);
    await rm(path.join(dir, ".basis", "template.json"));

    const workspace = await start(dir);
    // An updated Navbar.tsx would use classes the changed stylesheet does not have.
    assert.equal(await readFile(path.join(dir, "patterns", "Navbar.tsx"), "utf8"), source);
    assert.deepEqual(workspace.state.templateUpdate?.files, ["patterns/Navbar.module.css", "patterns/Navbar.tsx"]);
  });

  test("a skipped or brought-in update is not offered again, and a new workspace starts caught up", async () => {
    const dir = await folder();
    const fresh = await start(dir);
    assert.equal(fresh.state.templateUpdate, null);
    await fresh.close();

    await writeFile(path.join(dir, "components", "Tabs.tsx"), "export const Mine = 1;\n", { flag: "a" });
    await rm(path.join(dir, ".basis", "template.json"));
    const behind = await start(dir);
    assert.deepEqual(behind.state.templateUpdate?.files, ["components/Tabs.tsx"]);
    await behind.settleTemplateUpdate();
    assert.equal(behind.state.templateUpdate, null);
    await behind.close();

    assert.equal((await start(dir)).state.templateUpdate, null);
  });

  test("the changes since a version are what the agent is told", async () => {
    assert.match(await templateChanges(0), /^## 1/);
    assert.equal(await templateChanges(TEMPLATE_VERSION), "");
  });

  test("template/history.json lists every earlier version of the starter files", () => {
    const saved = JSON.parse(readFileSync(path.join(basis, "template", "history.json"), "utf8"));
    assert.deepEqual(saved, earlierTemplateHashes(basis), "Run `npm run template:history` after changing template/.");
  });
});

describe("views", () => {
  test("an older workspace without views gets the starter view", async () => {
    const dir = await folder();
    await (await start(dir)).close();
    git(dir, ["rm", "-rq", "views"]);
    git(dir, ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-q", "-m", "older workspace"]);
    const workspace = await start(dir);
    assert.ok(existsSync(path.join(dir, "views", "TeamMembers.specimen.tsx")));
    assert.equal(workspace.entries.at(-1)?.label, "Basis added a starter view");
  });
});

describe("reviews", () => {
  test("turns become iterations, and approving makes one history entry", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "Softer primary", async () => {
      await setToken(dir, "#b4232a");
      await openReview(dir);
    });
    assert.equal(workspace.review?.title, "Softer primary");
    assert.equal(workspace.review?.steps.length, 1);
    assert.equal(workspace.entries.length, 1, "history waits for the review");

    await turn(workspace, "A bit darker", () => setToken(dir, "#7f1d1d"));
    assert.deepEqual(
      workspace.review?.steps.map((step) => step.label),
      ["Softer primary", "A bit darker"],
    );

    await workspace.approveReview();
    assert.equal(workspace.review, null);
    assert.equal(workspace.entries.length, 2);
    assert.equal(workspace.entries.at(-1)?.source, "review");
    assert.equal(workspace.entries.at(-1)?.label, "Softer primary");
    assert.deepEqual(workspace.entries.at(-1)?.changed, ["color.light.primary"]);
    assert.equal(await token(dir), "#7f1d1d");
    assert.equal(existsSync(path.join(dir, "review.json")), false);
    assert.equal(git(dir, ["for-each-ref", "refs/basis"]), "");
    assert.equal(git(dir, ["status", "--porcelain"]), "");
  });

  test("discarding puts everything back, including removing new files", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    const before = await token(dir);
    await turn(workspace, "Try a new card", async () => {
      await openReview(dir, "Try a new card");
      await setToken(dir, "#000000");
      await writeFile(path.join(dir, "components", "Fancy.tsx"), "export const fancy = 1;\n");
    });
    await workspace.discardReview();
    assert.equal(workspace.review, null);
    assert.equal(await token(dir), before);
    assert.equal(existsSync(path.join(dir, "components", "Fancy.tsx")), false);
    assert.equal(workspace.entries.length, 1);
    assert.equal(git(dir, ["status", "--porcelain"]), "");
  });

  test("going back to an iteration restores it as a new iteration", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "First", async () => {
      await openReview(dir);
      await setToken(dir, "#111111");
    });
    await turn(workspace, "Second", async () => {
      await setToken(dir, "#222222");
      await writeFile(path.join(dir, "components", "Extra.tsx"), "export const extra = 1;\n");
    });
    const first = workspace.review!.steps[0]!.id;
    await workspace.reviewStep(first);
    assert.equal(await token(dir), "#111111");
    assert.equal(existsSync(path.join(dir, "components", "Extra.tsx")), false);
    assert.deepEqual(
      workspace.review?.steps.map((step) => step.label),
      ["First", "Second", "Back to iteration 1"],
    );
  });

  test("an open review survives a restart, and edits made meanwhile land in it", async () => {
    const dir = await folder();
    const first = await start(dir);
    await turn(first, "First", async () => {
      await openReview(dir);
      await setToken(dir, "#111111");
    });
    await first.close();
    await setToken(dir, "#333333");
    const workspace = await start(dir);
    assert.equal(workspace.review?.title, "Softer primary");
    assert.equal(workspace.review?.steps.length, 2);
    assert.equal(workspace.entries.length, 1);
  });

  test("history cannot be restored while a review is open", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "First", async () => {
      await openReview(dir);
      await setToken(dir, "#111111");
    });
    await workspace.revert(workspace.entries[0]!.id);
    assert.equal(await token(dir), "#111111");
    assert.equal(workspace.entries.length, 1);
  });

  test("an invalid review.json is reported and the turn goes to history as usual", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "Oops", async () => {
      await writeFile(path.join(dir, "review.json"), JSON.stringify({ show: [] }));
      await setToken(dir, "#111111");
    });
    assert.equal(workspace.review, null);
    assert.ok(workspace.state.reviewErrors?.length);
    assert.equal(workspace.entries.at(-1)?.label, "Oops");
  });

  test("updating review.json changes what the open review shows", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "First", async () => {
      await openReview(dir);
      await setToken(dir, "#111111");
    });
    const baseline = workspace.review?.baseline;
    await turn(workspace, "Focus on tabs", async () => {
      await writeFile(
        path.join(dir, "review.json"),
        JSON.stringify({ title: "Tabs instead", show: [{ specimen: "Tabs" }] }),
      );
    });
    assert.equal(workspace.review?.title, "Tabs instead");
    assert.deepEqual(workspace.review?.show, [
      { specimen: "Tabs", block: undefined, rows: undefined, columns: undefined },
    ]);
    assert.equal(workspace.review?.baseline, baseline);
  });
});

describe("alternatives", () => {
  /** Makes one take the way AgentHost does: a turn, then recorded as the next alternative. */
  async function take(workspace: Workspace, dir: string, label: string, value: string, first = false) {
    if (!first) await workspace.nextAlternative();
    await turn(workspace, `Alternative ${label}: Bolder`, async () => {
      if (first && !workspace.review) await openReview(dir, "Bolder");
      await setToken(dir, value);
    });
    return workspace.alternativeDone(label);
  }

  test("each take starts from the same point and is an iteration; choosing one continues from it", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await turn(workspace, "First", async () => {
      await openReview(dir);
      await setToken(dir, "#111111");
    });
    const first = workspace.review!.steps[0]!.id;

    await workspace.beginAlternatives("Bolder", 3);
    assert.ok(await take(workspace, dir, "A", "#aaaaaa", true));
    assert.ok(await take(workspace, dir, "B", "#bbbbbb"));
    assert.ok(await take(workspace, dir, "C", "#cccccc"));
    await workspace.endAlternatives();

    const review = workspace.review!;
    assert.deepEqual(
      review.steps.map((step) => step.label),
      ["First", "Alternative A: Bolder", "Alternative B: Bolder", "Alternative C: Bolder"],
    );
    assert.equal(review.alternatives?.done, true);
    assert.equal(review.alternatives?.start, first);
    assert.deepEqual(
      review.alternatives?.options.map((option) => option.label),
      ["A", "B", "C"],
    );
    // B and C build on the starting point, not on the take before them.
    assert.equal(git(dir, ["rev-parse", `${review.steps[2]!.id}^`]), first);
    assert.equal(git(dir, ["rev-parse", `${review.steps[3]!.id}^`]), first);
    assert.equal(await token(dir), "#cccccc");

    await workspace.chooseAlternative("A");
    assert.equal(await token(dir), "#aaaaaa");
    assert.equal(workspace.review?.alternatives, undefined);
    assert.equal(workspace.review?.steps.at(-1)?.label, "Chose alternative A");
  });

  test("the first take can open the review, and choosing the one on show adds no iteration", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    const head = git(dir, ["rev-parse", "HEAD"]);
    await workspace.beginAlternatives("Bolder", 2);
    assert.ok(await take(workspace, dir, "A", "#aaaaaa", true));
    assert.ok(await take(workspace, dir, "B", "#bbbbbb"));
    await workspace.endAlternatives();
    assert.equal(workspace.review?.baseline, head);
    assert.equal(workspace.review?.alternatives?.start, head);

    await workspace.chooseAlternative("B");
    assert.equal(workspace.review?.alternatives, undefined);
    assert.equal(workspace.review?.steps.length, 2);
    assert.equal(await token(dir), "#bbbbbb");
  });

  test("a new iteration after the set puts it away", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await workspace.beginAlternatives("Bolder", 2);
    await take(workspace, dir, "A", "#aaaaaa", true);
    await take(workspace, dir, "B", "#bbbbbb");
    await workspace.endAlternatives();
    await turn(workspace, "A bit darker", () => setToken(dir, "#222222"));
    assert.equal(workspace.review?.alternatives, undefined);
    assert.equal(workspace.review?.steps.length, 3);
  });

  test("without a review there is no set, and the take goes to history as usual", async () => {
    const dir = await folder();
    const workspace = await start(dir);
    await workspace.beginAlternatives("Bolder", 2);
    await turn(workspace, "Alternative A: Bolder", () => setToken(dir, "#aaaaaa"));
    assert.equal(await workspace.alternativeDone("A"), false);
    await workspace.endAlternatives();
    assert.equal(workspace.review, null);
    assert.equal(workspace.entries.at(-1)?.label, "Alternative A: Bolder");
  });
});
