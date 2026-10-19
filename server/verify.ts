import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import { build } from "vite";
import { KIT_FOLDER, READY_ATTRIBUTE, shotFile } from "../shared/capture.ts";
import type { Design } from "../shared/design.ts";
import type { VerifyKitSummary } from "../shared/protocol.ts";
import { CAPTURE_ARGS, captureViews, launchCaptureBrowser } from "./capture.ts";
import { readSources } from "./reach.ts";
import { readView, viewNotes } from "./verify-notes.ts";
import { agentsParagraph, promptFile, SKILL_MARKER, SKILL_PATH, skillFile } from "./verify-prompt.ts";
import { boxesFile, MEDIA_SELECTOR } from "./verify-kit/compare.mjs";

/*
 * The verification kit: what an agent implementing a feature needs to prove the implementation looks like the
 * design. A static, runnable copy of the design (design/), the screenshots Basis took of every screen of every
 * view (screens/), the settings they were taken with (basis-verify.json), and two scripts that capture the
 * implementation the same way and compare the two pixel for pixel (capture.mjs, compare.mjs). For the agent that
 * builds the views in the product: PROMPT.md, SKILL.md, notes per view (views/<view>.md) and the views' source.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const kitSource = path.join(import.meta.dirname, "verify-kit");

export const MANIFEST = "basis-verify.json";
/** What Basis writes and replaces; everything else in the kit's folder (targets.json, exceptions.json, actual/) is the project's. */
const GENERATED = [
  "design",
  "screens",
  "expected",
  "diff",
  MANIFEST,
  "README.md",
  "PROMPT.md",
  "SKILL.md",
  "views",
  "source",
  "capture.mjs",
  "compare.mjs",
  "targets.example.json",
  "exceptions.example.json",
];

/** Rules the implementation's pages get while they are captured, so nothing moves between two captures. */
export const NEUTRAL_CSS =
  "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";

export interface KitFile {
  path: string;
  data: Uint8Array;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Builds the capture page with the workspace's components into `outDir`, as index.html beside design.json. */
async function buildDesign(design: Design, workspaceDir: string, outDir: string): Promise<void> {
  await build({
    root: repoRoot,
    configFile: path.join(repoRoot, "vite.config.ts"),
    base: "./",
    logLevel: "silent",
    resolve: {
      alias: {
        "@ds": path.join(workspaceDir, "components", "index.ts"),
        "@workspace": workspaceDir,
      },
      dedupe: ["react", "react-dom"],
    },
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { input: path.join(repoRoot, "capture.html") },
    },
  });
  await rename(path.join(outDir, "capture.html"), path.join(outDir, "index.html"));
  await writeFile(path.join(outDir, "design.json"), `${JSON.stringify(design, null, 2)}\n`);
}

/** Serves a folder on a free local port, for the browser to open the built design from. */
async function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
    const file = path.join(dir, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(dir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
      },
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

async function filesIn(dir: string, prefix: string): Promise<KitFile[]> {
  const entries = (await readdir(dir, { recursive: true })).sort();
  const files: KitFile[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (!(await stat(full)).isFile()) continue;
    files.push({ path: `${prefix}/${entry.split(path.sep).join("/")}`, data: await readFile(full) });
  }
  return files;
}

async function packageVersion(): Promise<string> {
  return (JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
}

export interface BuildKitOptions {
  design: Design;
  workspaceDir: string;
  onProgress?: (step: string, done?: number, total?: number) => void;
}

/** Builds the design, photographs every screen and returns the kit's files with a summary for the user. */
export async function buildVerificationKit({
  design,
  workspaceDir,
  onProgress,
}: BuildKitOptions): Promise<{ files: KitFile[]; summary: VerifyKitSummary }> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "basis-verify-"));
  const designDir = path.join(temp, "design");
  try {
    onProgress?.("Building the design");
    await buildDesign(design, workspaceDir, designDir);
    onProgress?.("Starting the browser");
    const { browser, name, version } = await launchCaptureBrowser();
    const server = await serve(designDir);
    let result;
    try {
      result = await captureViews(server.url, browser, (done, total) =>
        onProgress?.("Taking screenshots", done, total),
      );
    } finally {
      server.close();
      await browser.close();
    }
    const { views, problems, shots } = result;
    const byFile = new Map(shots.map((shot) => [shot.file, shot]));
    const sources = await readSources(workspaceDir);
    const read = new Map(views.map((view) => [view.id, readView(sources, view.file)]));
    const generator = `basis-design ${await packageVersion()}`;
    const manifest = {
      format: 1,
      generator,
      createdAt: new Date().toISOString(),
      designSystem: design.name,
      browser: { name, version, platform: process.platform },
      render: {
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "light",
        args: CAPTURE_ARGS,
        neutralCss: NEUTRAL_CSS,
        base: await readFile(path.join(repoRoot, "src", "capture", "capture.css"), "utf8"),
      },
      media: {
        selector: MEDIA_SELECTOR,
        note: "Elements marked data-basis-media hold placeholder images. compare.mjs leaves them out of every shot as long as both sides have them at the same places and sizes; mark the implementation's own images the same way.",
      },
      prompt: "PROMPT.md",
      design: {
        entry: "design/index.html",
        query: "?view={view}&screen={screen}&theme={theme}",
        ready: `html[${READY_ATTRIBUTE}]`,
        error: "html[data-basis-error]",
      },
      views: views.map((view) => ({
        id: view.id,
        title: view.title,
        notes: `views/${view.id}.md`,
        screens: view.screens.map((screen) => ({
          id: screen.id,
          label: screen.label,
          shots: screen.shots.map((planned) => {
            const shot = byFile.get(shotFile(view.id, screen.id, planned));
            return {
              ...planned,
              file: shot?.file,
              imageHeight: shot?.imageHeight,
              stable: shot?.stable,
              failed: shot?.failed,
              remoteMedia: shot?.remote.length ? shot.remote : undefined,
            };
          }),
        })),
      })),
      problems,
    };
    const targets = {
      baseUrl: "http://localhost:3000",
      screens: Object.fromEntries(
        views.flatMap((view) => view.screens.map((screen) => [`${view.id}/${screen.id}`, "/"])),
      ),
    };
    const exceptions = {
      exceptions: [
        {
          name: "example-avatar",
          reason: "Why this part may differ, in a sentence the reviewer can check.",
          view: views[0]?.id ?? "<view id>",
          screen: views[0]?.screens[0]?.id,
          widths: [375],
          region: { x: 16, y: 16, width: 40, height: 40 },
        },
        {
          name: "example-chart",
          reason: "The live chart draws the product's real numbers.",
          view: views[0]?.id ?? "<view id>",
          selector: "canvas",
        },
      ],
    };
    const text = (file: string, content: string): KitFile => ({ path: file, data: strToU8(content) });
    const reached = [...new Set([...read.values()].flatMap((view) => view.files))].sort();
    const files: KitFile[] = [
      text(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`),
      text("README.md", readme(design.name, generator, name, version)),
      text("PROMPT.md", promptFile(design.name, generator, manifest.views)),
      text("SKILL.md", skillFile(manifest.views)),
      ...manifest.views.map((view) => text(view.notes, viewNotes(view, read.get(view.id)!, design, KIT_FOLDER))),
      ...(await Promise.all(
        reached.map(async (file) => ({ path: `source/${file}`, data: await readFile(path.join(workspaceDir, file)) })),
      )),
      text("capture.mjs", await readFile(path.join(kitSource, "capture.mjs"), "utf8")),
      text("compare.mjs", await readFile(path.join(kitSource, "compare.mjs"), "utf8")),
      text("targets.example.json", `${JSON.stringify(targets, null, 2)}\n`),
      text("exceptions.example.json", `${JSON.stringify(exceptions, null, 2)}\n`),
      ...(await filesIn(designDir, "design")),
      ...shots.flatMap((shot) => [
        { path: shot.file, data: new Uint8Array(shot.png) },
        text(boxesFile(shot.file), `${JSON.stringify(shot.boxes, null, 2)}\n`),
      ]),
    ];
    const summary: VerifyKitSummary = {
      browser: `${name} ${version}`,
      views: views.length,
      viewList: views.map((view) => ({ id: view.id, title: view.title })),
      screens: views.reduce((sum, view) => sum + view.screens.length, 0),
      shots: shots.length,
      unstable: shots.filter((shot) => !shot.stable).map((shot) => shot.file),
      failed: shots.filter((shot) => shot.failed).map((shot) => shot.file),
      remote: shots.filter((shot) => shot.remote.length).map((shot) => shot.file),
      problems,
    };
    return { files, summary };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function zipVerificationKit(files: KitFile[]): Uint8Array {
  const entries: Zippable = {};
  // PNGs are compressed already; deflating them again only costs time.
  for (const file of files)
    entries[`${KIT_FOLDER}/${file.path}`] = [file.data, { level: file.path.endsWith(".png") ? 0 : 6 }];
  return zipSync(entries);
}

/** What became of the kit's skill when it was to be installed in the product (`.claude/skills/basis-verify/`). */
export interface SkillInstall {
  file: string;
  /** False when a SKILL.md without Basis' marker was there, which Basis leaves alone. */
  written: boolean;
}

/**
 * Writes the kit into `<project>/basis-verify/`. A folder by that name that is not a kit (no manifest) is left
 * alone; in a kit, the files Basis generates are replaced and the project's own (targets.json, exceptions.json,
 * actual/) are kept. With `skill`, the kit's SKILL.md also goes to `<project>/.claude/skills/basis-verify/`,
 * replacing a file there only when Basis wrote it (it has the marker).
 */
export async function writeVerificationKit(
  files: KitFile[],
  project: string,
  { skill = false }: { skill?: boolean } = {},
): Promise<{ ok: true; dir: string; skill?: SkillInstall } | { ok: false; error: string }> {
  const trimmed = project.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return { ok: false, error: "Enter an absolute folder path." };
  const root = path.resolve(trimmed);
  const relativeToBasis = path.relative(repoRoot, root);
  if (!relativeToBasis.startsWith("..") && !path.isAbsolute(relativeToBasis)) {
    return { ok: false, error: "That folder is inside Basis itself. Pick your project's folder." };
  }
  if (!existsSync(root) || !(await stat(root)).isDirectory())
    return { ok: false, error: "That folder does not exist." };
  const dir = path.join(root, KIT_FOLDER);
  if (existsSync(dir) && !existsSync(path.join(dir, MANIFEST)) && (await readdir(dir)).length > 0) {
    return { ok: false, error: `${dir} exists and is not a verification kit. Move it away or pick another folder.` };
  }
  for (const entry of GENERATED) await rm(path.join(dir, entry), { recursive: true, force: true });
  for (const file of files) {
    const destination = path.join(dir, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.data);
  }
  const content = files.find((file) => file.path === "SKILL.md")?.data;
  if (!skill || !content) return { ok: true, dir };
  const file = path.join(root, ...SKILL_PATH.split("/"));
  const ours = !existsSync(file) || (await readFile(file, "utf8")).includes(SKILL_MARKER);
  if (ours) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { ok: true, dir, skill: { file, written: ours } };
}

function readme(name: string, generator: string, browser: string, version: string): string {
  return `# Verification kit: ${name}

Generated by ${generator} with ${browser} ${version}. Basis replaces this folder's generated files
(\`design/\`, \`screens/\`, \`expected/\`, \`diff/\`, \`views/\`, \`source/\`, \`basis-verify.json\`, the prompt,
the skill, the scripts and the examples) each time it writes the kit; \`targets.json\`, \`exceptions.json\` and
\`actual/\` are yours and stay.

The kit says what each screen of each view must look like, pixel for pixel, at fixed sizes. The target is
0% difference. Anything allowed to differ is a named exception in \`exceptions.json\`, so a reviewer can read
every one of them.

## For the agent that builds it

\`PROMPT.md\` is written for the coding agent that builds these views in the product: the goal, where things are,
each view, and the capture and compare loop with the rules for images, exceptions and when to stop. Tell the
agent to read it (Basis' Export tab copies such a prompt), with the kit at \`basis-verify/\` in the product repo's
root, where all its paths start.

\`SKILL.md\` is the loop as a Claude Code skill. Basis can install it as \`${SKILL_PATH}\` when it writes the
kit into the repo; to do it by hand, copy the file there. For agents that read \`AGENTS.md\`, add this paragraph:

> ${agentsParagraph().split("\n").join("\n> ")}

## Contents

- \`PROMPT.md\`, \`SKILL.md\`: see above.
- \`views/<view>.md\`: notes for each view, written from its source: its screens and their shots, where each
  screen's \`go()\` calls lead, the components, patterns and data it uses, and the tokens it reads, with their
  values in \`design/design.json\`.
- \`source/\`: the source of the views and of everything they import, as it is in Basis' workspace.
- \`design/\`: the design as a static site. Serve the folder and open
  \`index.html?view=<view>&screen=<screen>&theme=light\` to see one screen alone, at the size of the window.
  The screens are clickable where the design moves between them.
- \`screens/\`: what Basis captured, named \`<view>/<screen>@<width>[x<height>][-dark].png\`, each with a
  \`.boxes.json\` beside it: where the elements marked \`data-basis-media\` are in the image.
- \`basis-verify.json\`: every view, screen and shot (width, viewport height, full page or not, theme), and the
  settings the shots were taken with: device scale 1, reduced motion, light color scheme, the Chromium flags in
  \`render.args\`, and the CSS every captured page gets (\`render.neutralCss\`). A shot that loads images from
  another site lists them in \`remoteMedia\`.
- \`capture.mjs\`: takes the same shots of the design or of the implementation, on this machine.
- \`compare.mjs\`: compares the two sets and writes diff images.

## Check an implementation

Both scripts need Node 22 and Playwright in the project:

\`\`\`bash
npm i -D playwright
npx playwright install chromium
\`\`\`

1. Capture the design on this machine. Fonts and antialiasing differ between operating systems, so compare
   images taken on the same machine with the same browser. \`screens/\` is the reference only when nothing
   else is there.

   \`\`\`bash
   node basis-verify/capture.mjs design
   \`\`\`

2. Point each screen at the page that implements it: copy \`targets.example.json\` to \`targets.json\` and fill
   in the URLs (relative to \`baseUrl\`, or absolute). An entry is a URL, or
   \`{ "url": "/team/42", "waitFor": "[data-loaded]" }\` to wait for an element before capturing. Optional:
   \`"storageState": "auth.json"\` (a Playwright storage state, for pages behind a login) and
   \`"themeAttribute": "data-theme"\` (set on \`<html>\` to the shot's theme, for apps that switch themes with an
   attribute rather than the color scheme).

3. Start the app and capture it:

   \`\`\`bash
   node basis-verify/capture.mjs app
   \`\`\`

4. Compare:

   \`\`\`bash
   node basis-verify/compare.mjs
   \`\`\`

   Each shot prints PASS, FAIL (with the share of differing pixels, and what is wrong with the elements left
   out), MISSING or EXCEPTED. Failures get a diff image in \`diff/\`: matching pixels faded, differing pixels red,
   left-out regions and elements blue. \`diff/report.json\` has the same results for tools. The command exits
   with 1 when any shot fails or is missing. Both scripts take \`--only <view>[/<screen>]\` to work on part of
   the kit.

A screen is the whole page as the product shows it. The page's size matters too: a full-page shot that is
taller or shorter than the design fails even when the top matches.

## Make it match

- Use the design's tokens and the same page structure. Compare against \`design/\` in a browser at the same
  width when a diff is hard to read.
- Data must be the same as in the design. The design uses the product's real data where it could; where the
  implementation loads data, point it at the same records, or seed them.
- Anything that changes between two loads (clocks, random values, animations, content that arrives late)
  makes a shot unstable: \`capture.mjs\` says so, and such a shot can never match.

## Images

Photos, avatars and illustrations cannot match pixel for pixel: the design shows placeholders, the product its
own images. The design marks each such element with \`data-basis-media\`. Mark the element in the
implementation that takes its place the same way (\`<img data-basis-media src={product.photo} ...>\`).
\`compare.mjs\` then leaves those elements out of every shot, but checks that both sides have as many of them,
each at the same place and with the same size, to the pixel (\`--box-tolerance <px>\` allows more). A missing,
moved or resized image still fails the shot. \`capture.mjs\` writes where they are into a \`.boxes.json\` beside
each image.

## Exceptions

When part of a screen cannot match for a reason you can name, add it to \`exceptions.json\` (start from
\`exceptions.example.json\`):

\`\`\`json
{
  "exceptions": [
    {
      "name": "usage-chart",
      "reason": "The live chart draws the product's real numbers.",
      "view": "team-members",
      "screen": "list",
      "widths": [375],
      "themes": ["light"],
      "selector": "canvas"
    }
  ]
}
\`\`\`

\`screen\`, \`widths\` and \`themes\` narrow where it applies; without them it applies to every screen, width or
theme of the view. \`selector\` leaves out the elements it matches, checked as images are (same number, place
and size on both sides); when the two sides need different selectors, give
\`{ "design": "...", "app": "..." }\`. \`capture.mjs\` measures the selectors in \`exceptions.json\` when it
captures, so capture both sides again after adding one. \`region\` (\`{ "x", "y", "width", "height" }\`, in the
image's pixels) leaves out a fixed part of the image. With neither, the whole shot is excepted. Keep exceptions
few and specific: every one is a part of the design nobody checks.
`;
}
