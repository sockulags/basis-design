import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { REVIEW_FILE } from "../shared/review.ts";
import { AGENT_BRIEF, CLAUDE_MD } from "./brief.ts";
import { COMPONENTS_DIR, PATTERNS_DIR, repoRoot, SOURCE_DIRS, VIEWS_DIR } from "./paths.ts";
import { updateUntouchedStarterFiles } from "./template.ts";

const require = createRequire(import.meta.url);

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
  // Starter files nobody changed follow the template (see server/template.ts).
  const updated = await updateUntouchedStarterFiles(dir);
  const parts = notes.length ? [`added ${notes.join(" and ")}`] : [];
  if (updated.length) parts.push(`updated ${updated.length === 1 ? updated[0] : `${updated.length} starter files`}`);
  return parts.length ? `Basis ${parts.join(" and ")}` : "";
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

/**
 * The workspace format this Basis writes. Raise it when a change means an older Basis would misread or damage a
 * workspace this one has opened; an older Basis then refuses to open it instead.
 */
export const WORKSPACE_FORMAT = 1;

/** Refuses a workspace a newer Basis has opened, and marks it with this Basis' format otherwise. */
export async function claimWorkspaceFormat(dir: string): Promise<void> {
  const file = path.join(dir, ".basis", "format.json");
  const saved = existsSync(file) ? Number(JSON.parse(await readFile(file, "utf8")).format) || 0 : 0;
  if (saved > WORKSPACE_FORMAT) {
    throw new Error("a newer version of Basis has opened this project. Update Basis to open it again.");
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ format: WORKSPACE_FORMAT })}\n`);
}

/** Files Basis owns in the workspace, rewritten on every start and kept out of history. */
export async function writeGeneratedFiles(dir: string): Promise<void> {
  const basisDir = path.join(dir, ".basis");
  await mkdir(basisDir, { recursive: true });
  // Resolved, not joined onto Basis' folder: an npm install may hoist them to a node_modules above it.
  const types = (pkg: string) =>
    path
      .dirname(require.resolve(`${pkg}/package.json`))
      .split(path.sep)
      .join("/");
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
    path.join(basisDir, "guidelines.md"),
    await readFile(path.join(repoRoot, "server", "guidelines.md"), "utf8"),
  );
  // Imported images (a view's placeholders in views/assets/) are URLs, as Vite serves and builds them.
  const images = ["svg", "png", "jpg", "jpeg", "webp", "avif", "gif"].map(
    (extension) => `declare module "*.${extension}" {\n  const url: string;\n  export default url;\n}\n`,
  );
  await writeFile(
    path.join(basisDir, "env.d.ts"),
    [
      'declare module "*.module.css" {\n  const classes: Record<string, string>;\n  export default classes;\n}\n',
      ...images,
    ].join(""),
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
