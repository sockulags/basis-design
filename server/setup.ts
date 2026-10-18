import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REVIEW_FILE } from "../shared/review.ts";
import { AGENT_BRIEF, CLAUDE_MD } from "./brief.ts";
import { COMPONENTS_DIR, PATTERNS_DIR, repoRoot, SOURCE_DIRS, VIEWS_DIR } from "./paths.ts";

/*
 * Getting a workspace ready on every start: starter source for new
 * workspaces, what Basis added since for older ones, and the files Basis owns.
 */

/**
 * Seeds a new workspace from template/, or brings an older one up to date.
 * Returns a note for the history entry ("Basis added component contracts"),
 * or "" when nothing an existing workspace would notice was added.
 */
export async function seedWorkspace(dir: string): Promise<string> {
  const components = path.join(dir, COMPONENTS_DIR);
  const notes: string[] = [];
  if (!existsSync(components)) await seed(dir, COMPONENTS_DIR);
  else if (!existsSync(path.join(components, "specimen.ts"))) {
    await seed(dir, COMPONENTS_DIR, (name) => name.includes("specimen"));
    notes.push("gallery specimens");
  }
  if (!existsSync(path.join(components, "contracts.ts"))) {
    await seed(dir, COMPONENTS_DIR, (name) => name === "contracts.ts");
    notes.push("component contracts");
  }
  if (!existsSync(path.join(dir, PATTERNS_DIR))) {
    const fresh = notes.length === 0 && !existsSync(path.join(dir, ".git"));
    await seed(dir, PATTERNS_DIR);
    if (!fresh) notes.push("starter patterns");
  } else {
    if (!existsSync(path.join(dir, PATTERNS_DIR, "contracts.ts"))) {
      await seed(dir, PATTERNS_DIR, (name) => name === "contracts.ts");
      notes.push("pattern contracts");
    }
    const added = await addLaterPatterns(dir);
    if (added.length) notes.push(`the ${added.join(" and ")} pattern${added.length > 1 ? "s" : ""}`);
  }
  if (!existsSync(path.join(dir, VIEWS_DIR))) {
    const fresh = notes.length === 0 && !existsSync(path.join(dir, ".git"));
    await seed(dir, VIEWS_DIR);
    if (!fresh) notes.push("a starter view");
  }
  if (await updateSpecimenFormat(dir)) notes.push("the newest specimen format");
  return notes.length ? `Basis added ${notes.join(" and ")}` : "";
}

/**
 * Starter patterns added to the baseline after workspaces already had patterns/.
 * Older workspaces get their files and an export in patterns/index.ts, since the
 * baseline contract requires them.
 */
const LATER_PATTERNS = ["Composer", "Chat"];

async function addLaterPatterns(dir: string): Promise<string[]> {
  const index = path.join(dir, PATTERNS_DIR, "index.ts");
  const added: string[] = [];
  for (const name of LATER_PATTERNS) {
    if (existsSync(path.join(dir, PATTERNS_DIR, `${name}.tsx`))) continue;
    await seed(dir, PATTERNS_DIR, (file) => file.startsWith(`${name}.`));
    const exports = await readFile(index, "utf8").catch(() => "");
    if (!exports.includes(`"./${name}.tsx"`)) {
      const separator = exports === "" || exports.endsWith("\n") ? "" : "\n";
      await writeFile(index, `${exports}${separator}export * from "./${name}.tsx";\n`);
    }
    added.push(name);
  }
  return added;
}

/**
 * components/specimen.ts is Basis' specimen format, seeded once. When it is an
 * untouched copy of an earlier version, it is replaced with the current one;
 * a copy someone changed is left alone. Add the hash of the current template
 * here whenever the template changes (sha256 of its text with LF line endings).
 */
const EARLIER_SPECIMEN_FORMATS = new Set([
  "e04c6fc2a3e85090b7672d229d95ca8c5a42009f6397332230d324357b993169",
  "03370daf9bba1c4329d3dac7b76199970cab9c11a6ea2d23e1a484ead80d36d6",
  "1f826f8c8f183e311fd20cca0e5e3c138ac2775c4e156862600c24e9dad7cf7d",
]);

async function updateSpecimenFormat(dir: string): Promise<boolean> {
  const file = path.join(dir, COMPONENTS_DIR, "specimen.ts");
  const current = (await readFile(file, "utf8").catch(() => "")).replaceAll("\r\n", "\n");
  if (!EARLIER_SPECIMEN_FORMATS.has(createHash("sha256").update(current).digest("hex"))) return false;
  const template = await readFile(path.join(repoRoot, "template", COMPONENTS_DIR, "specimen.ts"), "utf8");
  await writeFile(file, template.replaceAll("\r\n", "\n"));
  return true;
}

/**
 * Copies starter files from template/<folder> that are missing, normalising
 * line endings (a Windows checkout of Basis may have CRLF).
 */
async function seed(dir: string, folder: string, only: (name: string) => boolean = () => true): Promise<void> {
  const source = path.join(repoRoot, "template", folder);
  const destination = path.join(dir, folder);
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    if (!only(name) || existsSync(path.join(destination, name))) continue;
    const text = await readFile(path.join(source, name), "utf8");
    await writeFile(path.join(destination, name), text.replaceAll("\r\n", "\n"));
  }
}

/** Files Basis owns in the workspace, rewritten on every start and kept out of history. */
export async function writeGeneratedFiles(dir: string): Promise<void> {
  const basisDir = path.join(dir, ".basis");
  await mkdir(basisDir, { recursive: true });
  const types = (pkg: string) => path.join(repoRoot, "node_modules", pkg).split(path.sep).join("/");
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      types: [],
      // Resolve React's types from the Basis install, wherever this workspace lives.
      paths: {
        react: [`${types("@types/react")}/index.d.ts`],
        "react/*": [`${types("@types/react")}/*`],
        "react-dom": [`${types("@types/react-dom")}/index.d.ts`],
        "react-dom/*": [`${types("@types/react-dom")}/*`],
      },
    },
    include: [...SOURCE_DIRS.map((folder) => `${folder}/**/*`), ".basis/*.ts"],
  };
  await writeFile(path.join(dir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
  await writeFile(
    path.join(basisDir, "contracts.ts"),
    await readFile(path.join(repoRoot, "shared", "contracts.ts"), "utf8"),
  );
  await writeFile(
    path.join(basisDir, "pattern-contracts.ts"),
    await readFile(path.join(repoRoot, "shared", "pattern-contracts.ts"), "utf8"),
  );
  await writeFile(
    path.join(basisDir, "env.d.ts"),
    'declare module "*.module.css" {\n  const classes: Record<string, string>;\n  export default classes;\n}\n',
  );
  await writeFile(
    path.join(basisDir, "check.ts"),
    [
      "// Fails to type-check when components/ or patterns/ stop satisfying their contracts: the Basis",
      "// baselines (./contracts.ts, ./pattern-contracts.ts) and the contracts this design system added",
      "// (components/contracts.ts, patterns/contracts.ts).",
      'import type { Contracts } from "./contracts.ts";',
      'import type { AddedContracts } from "../components/contracts.ts";',
      'import * as components from "../components/index.ts";',
      'import type { PatternContracts } from "./pattern-contracts.ts";',
      'import type { AddedPatternContracts } from "../patterns/contracts.ts";',
      'import type { IconName } from "../patterns/icons.tsx";',
      'import * as patterns from "../patterns/index.ts";',
      "",
      "export const satisfiesContracts: Contracts & AddedContracts = components;",
      "export const satisfiesPatternContracts: PatternContracts<IconName> & AddedPatternContracts = patterns;",
      "",
      "// Every export of components/index.ts needs a contract; add missing ones to components/contracts.ts.",
      "type Uncovered = Exclude<keyof typeof components, keyof Contracts | keyof AddedContracts>;",
      "export const everyExportHasAContract: [Uncovered] extends [never] ? true : { missingContractFor: Uncovered } = true;",
      "",
      "// Every export of patterns/index.ts needs a contract; add missing ones to patterns/contracts.ts.",
      "type UncoveredPattern = Exclude<",
      "  keyof typeof patterns,",
      "  keyof PatternContracts<IconName> | keyof AddedPatternContracts",
      ">;",
      "export const everyPatternHasAContract: [UncoveredPattern] extends [never]",
      "  ? true",
      "  : { missingContractFor: UncoveredPattern } = true;",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(dir, "AGENTS.md"), AGENT_BRIEF);
  await writeFile(path.join(dir, "CLAUDE.md"), CLAUDE_MD);
  await writeFile(
    path.join(dir, ".gitignore"),
    `# Generated by Basis on every start\n.basis/\nAGENTS.md\nCLAUDE.md\ntsconfig.json\nnode_modules/\n${REVIEW_FILE}\n`,
  );
}
