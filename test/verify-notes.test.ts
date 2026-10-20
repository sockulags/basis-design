import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { strToU8 } from "fflate";
import { captureShots, kitFolder, viewKitFolder } from "../shared/capture.ts";
import { DEFAULT_DESIGN } from "../shared/design.ts";
import { kitPrompt } from "../shared/kit-prompt.ts";
import { readSources } from "../server/reach.ts";
import { readView, screenFlow, tokenRows, viewNotes } from "../server/verify-notes.ts";
import { agentsParagraph, promptFile, SKILL_MARKER, skillFile } from "../server/verify-prompt.ts";
import { writeVerificationKit } from "../server/verify.ts";

const template = path.resolve(import.meta.dirname, "..", "template");
const STARTER = "views/TeamMembers.specimen.tsx";

test("the starter view's flow comes from its literal go() calls, with the text of the element that calls each", () => {
  const flow = screenFlow(
    `function List({ go }: ScreenProps) {
  return (
    <div>
      <Button onClick={() => go("invite")}>Invite member</Button>
      <Row onOpen={(item) => go("detail", item)} />
      <Button onClick={() => go(next)}>Computed</Button>
    </div>
  );
}

function Detail({ go }: ScreenProps) {
  return <Back go={go} />;
}

function Back({ go }: { go: ScreenProps["go"] }) {
  return (
    <Button variant="ghost" onClick={() => go("list")}>
      Back to the list
    </Button>
  );
}

export default defineSpecimen({
  id: "items",
  blocks: [
    {
      kind: "flow",
      screens: [
        { id: "list", label: "List", render: List },
        { id: "detail", label: "Detail", render: Detail },
        { id: "invite", label: "Invite", render: ({ go }) => <Button onClick={() => go("list")}>Done</Button> },
      ],
    },
  ],
});
`,
  );
  assert.deepEqual(flow, {
    list: [
      { to: "invite", label: "Invite member", data: false },
      { to: "detail", label: undefined, data: true },
    ],
    // Through a helper the screen renders.
    detail: [{ to: "list", label: "Back to the list", data: false }],
    // An inline render.
    invite: [{ to: "list", label: "Done", data: false }],
  });
});

test("the starter view: its screens' flow, the components and patterns it imports, and the tokens they read", async () => {
  const sources = await readSources(template);
  const view = readView(sources, STARTER);
  assert.equal(
    view.description,
    "Browse the workspace's members, open one to change their role, or invite someone new.",
  );
  assert.deepEqual(view.flow, {
    list: [
      { to: "invite", label: "Invite member", data: false },
      { to: "member", label: undefined, data: true },
    ],
    member: [
      { to: "list", label: "Back to members", data: false },
      { to: "list", label: "Cancel", data: false },
      { to: "list", label: "Save", data: false },
    ],
    invite: [
      { to: "list", label: "Back to members", data: false },
      { to: "list", label: "Cancel", data: false },
    ],
  });
  const names = (items: { name: string; file: string }[]) => items.map((item) => `${item.name} ${item.file}`);
  assert.deepEqual(names(view.components), [
    "Avatar components/Display.tsx",
    "Badge components/Display.tsx",
    "Button components/Button.tsx",
    "Field components/Field.tsx",
    "Select components/Field.tsx",
    "TextInput components/Field.tsx",
  ]);
  assert.deepEqual(names(view.patterns), [
    "AppShell patterns/AppShell.tsx",
    "DataTable patterns/DataTable.tsx",
    "EmptyState patterns/EmptyState.tsx",
    "FormActions patterns/FormSection.tsx",
    "FormLayout patterns/FormSection.tsx",
    "FormSection patterns/FormSection.tsx",
    "Navbar patterns/Navbar.tsx",
    "PageHeader patterns/PageHeader.tsx",
    "SidebarNav patterns/SidebarNav.tsx",
  ]);
  // Type-only imports (Member) and the gallery's own helpers (defineSpecimen) are not listed.
  assert.deepEqual(names(view.data), [
    "initials patterns/specimen-data.ts",
    "MEMBERS patterns/specimen-data.ts",
    "NAV_LINKS patterns/specimen-data.ts",
    "SIDEBAR_SECTIONS patterns/specimen-data.ts",
  ]);
  assert.deepEqual(view.images, []);
  // What it reaches through the barrels, by the names it imports: not every component.
  assert.ok(view.files.includes(STARTER));
  assert.ok(view.files.includes("components/Button.module.css"));
  assert.ok(view.files.includes("patterns/PageHeader.module.css"));
  assert.ok(!view.files.includes("components/Tabs.tsx"));
  assert.ok(!view.files.includes("patterns/Chat.tsx"));
  assert.ok(!view.files.some((file) => file.endsWith("/index.ts")));
  assert.ok(view.vars.includes("--space-6"));
  assert.ok(view.vars.includes("--color-primary"));
});

test("a view's images and its own helper files count, and a component used only by a helper is listed", () => {
  const sources = new Map([
    [
      "views/Shop.specimen.tsx",
      `import photo from "./assets/shoe.svg";
import { ProductCard } from "./shop-parts.tsx";
import { PRODUCTS } from "./shop-data.ts";
export default defineSpecimen({ id: "shop", blocks: [] });`,
    ],
    ["views/shop-parts.tsx", `import { Button } from "../components/index.ts";\nexport function ProductCard() {}`],
    ["views/shop-data.ts", `export const PRODUCTS = [];`],
    ["views/assets/shoe.svg", ""],
    ["components/index.ts", `export * from "./Button.tsx";`],
    ["components/Button.tsx", `import styles from "./Button.module.css";\nexport function Button() {}`],
    ["components/Button.module.css", `.button { padding: var(--space-2); color: var(--not-a-token); }`],
  ]);
  const view = readView(sources, "views/Shop.specimen.tsx");
  assert.deepEqual(view.components, [{ name: "Button", file: "components/Button.tsx" }]);
  assert.deepEqual(view.images, ["views/assets/shoe.svg"]);
  assert.deepEqual(view.files, [
    "components/Button.module.css",
    "components/Button.tsx",
    "views/Shop.specimen.tsx",
    "views/assets/shoe.svg",
    "views/shop-data.ts",
    "views/shop-parts.tsx",
  ]);
  assert.deepEqual(view.vars, ["--not-a-token", "--space-2"]);
  // Only the variables that are the design's tokens get a row.
  assert.deepEqual(tokenRows(DEFAULT_DESIGN, view.vars), [
    { variable: "--space-2", path: "space.2", value: DEFAULT_DESIGN.space["2"] },
  ]);
});

test("token rows name where each token is in design.json, colours with both themes, and what a token refers to", () => {
  const [component, color, radius, text] = tokenRows(DEFAULT_DESIGN, [
    "--text-base",
    "--color-text-muted",
    "--button-radius",
  ]);
  assert.deepEqual(component, {
    variable: "--button-radius",
    path: "components.button.radius",
    value: DEFAULT_DESIGN.components.button.radius,
    component: "button",
  });
  assert.deepEqual(color, {
    variable: "--color-text-muted",
    path: "color.light.textMuted, color.dark.textMuted",
    value: `${DEFAULT_DESIGN.color.light.textMuted} / ${DEFAULT_DESIGN.color.dark.textMuted}`,
  });
  // The button's radius is var(--radius-md), so that token is used too.
  assert.equal(DEFAULT_DESIGN.components.button.radius, "var(--radius-md)");
  assert.deepEqual(radius, { variable: "--radius-md", path: "radius.md", value: DEFAULT_DESIGN.radius.md });
  assert.deepEqual(text, {
    variable: "--text-base",
    path: "typography.size.base",
    value: DEFAULT_DESIGN.typography.size.base,
  });
});

test("the starter view's notes list its screens, shots, flow, parts and tokens", async () => {
  const sources = await readSources(template);
  const shots = captureShots(undefined).map((shot) => ({
    ...shot,
    file: `screens/team-members/list@${shot.width}.png`,
  }));
  const notes = viewNotes(
    {
      id: "team-members",
      title: "Team members",
      screens: [
        { id: "list", label: "Member list", shots },
        { id: "member", label: "Member", shots },
        { id: "invite", label: "Invite", shots },
      ],
    },
    readView(sources, STARTER),
    DEFAULT_DESIGN,
    "basis-verify",
  );
  assert.match(notes, /^# Team members \(`team-members`\)/);
  assert.match(notes, /### `list`: Member list \(the first screen\)/);
  assert.match(
    notes,
    /- Shots: 375, 768 and 1440 px wide, full page, light\. `basis-verify\/screens\/team-members\/list@375\.png`/,
  );
  assert.match(notes, /- Leads to: `invite` \("Invite member"\) and `member` \(passes data\)/);
  assert.match(notes, /### `invite`: Invite\n\n[\s\S]*?- Reached from: `list`/);
  assert.match(
    notes,
    /- Components: `Avatar`, `Badge` \(`components\/Display\.tsx`\); `Button` \(`components\/Button\.tsx`\)/,
  );
  assert.match(notes, /\| `--space-6` \| `space\.6` \| `24px` \|/);
  // Reached through the button's own tokens.
  assert.match(notes, /\| `--radius-md` \| `radius\.md` \|/);
  assert.match(notes, /Component tokens .*`badge`, `button`/);
  assert.doesNotMatch(notes, /\| `--button-radius`/);
  assert.match(notes, /`basis-verify\/source\/`/);
});

test("PROMPT.md and SKILL.md share the loop, with paths from the repo's root", () => {
  const views = [{ id: "team-members", title: "Team members", screens: [{ id: "list", label: "Member list" }] }];
  const prompt = promptFile("Acme", "basis-design 0.2.0", views);
  const skill = skillFile(views);
  assert.match(
    prompt,
    /\| Team members \(`team-members`\) \| `list` Member list \| `basis-verify\/views\/team-members\.md` \|/,
  );
  for (const text of [prompt, skill]) {
    assert.match(text, /node basis-verify\/capture\.mjs design --only <view>/);
    assert.match(text, /node basis-verify\/compare\.mjs --only <view>\/<screen>/);
    assert.match(text, /`team-members\/list`/);
    assert.match(text, /data-basis-media/);
    assert.match(text, /three rounds in a row/);
  }
  const loop = (text: string) => text.slice(text.indexOf("## The loop"));
  assert.equal(loop(prompt), loop(skill));
  // Claude Code's skill format: frontmatter first, then the marker Basis looks for before replacing the file.
  assert.match(skill, /^---\nname: basis-verify\ndescription: "[^"\n]+"\n---\n\n<!-- Generated by Basis\./);
  assert.ok(skill.includes(SKILL_MARKER));
  assert.match(agentsParagraph(), /basis-verify\/PROMPT\.md/);
});

test("the copied prompt points at PROMPT.md and names the views to build", () => {
  const views = [
    { id: "team-members", title: "Team members" },
    { id: "billing", title: "Billing" },
  ];
  const all = kitPrompt({ views, zip: false });
  assert.match(all, /into `basis-verify\/` at the root of this repo/);
  assert.match(all, /"Team members" \(team-members\), "Billing" \(billing\)/);
  assert.match(all, /Read `basis-verify\/PROMPT\.md` first/);
  const one = kitPrompt({ views, view: "billing", zip: true });
  assert.match(one, /unpacked from the \.zip/);
  assert.match(one, /Build the view "Billing" \(billing\)/);
  assert.match(one, /`basis-verify\/views\/billing\.md`/);
  assert.doesNotMatch(one, /Team members/);
});

test("writing the kit installs the skill when asked, and keeps a SKILL.md Basis did not write", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "basis-skill-"));
  try {
    const files = [
      { path: "basis-verify.json", data: strToU8("{}") },
      { path: "SKILL.md", data: strToU8(`---\nname: basis-verify\n---\n\n${SKILL_MARKER} -->\nv1\n`) },
    ];
    const skillFile = path.join(project, ".claude", "skills", "basis-verify", "SKILL.md");
    const plain = await writeVerificationKit(files, project);
    assert.ok(plain.ok && !plain.skill);
    assert.ok(!existsSync(skillFile));

    const first = await writeVerificationKit(files, project, { skill: true });
    assert.deepEqual(first.ok && first.skill, { file: skillFile, written: true });
    assert.match(await readFile(skillFile, "utf8"), /v1/);

    // Basis' own file is replaced.
    files[1]!.data = strToU8(`---\nname: basis-verify\n---\n\n${SKILL_MARKER} -->\nv2\n`);
    await writeVerificationKit(files, project, { skill: true });
    assert.match(await readFile(skillFile, "utf8"), /v2/);

    // One the user made their own (the marker removed) stays.
    await writeFile(skillFile, "my own skill\n");
    const kept = await writeVerificationKit(files, project, { skill: true });
    assert.deepEqual(kept.ok && kept.skill, { file: skillFile, written: false });
    assert.equal(await readFile(skillFile, "utf8"), "my own skill\n");
    assert.ok(existsSync(path.join(project, "basis-verify", "SKILL.md")));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("compare.mjs --only compares one screen and leaves the rest of the kit out", async () => {
  const kit = await mkdtemp(path.join(tmpdir(), "basis-only-"));
  try {
    const { encodePng } = await import("../server/verify-kit/compare.mjs");
    const png = encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
    const shot = (screen: string) => ({
      width: 2,
      viewportHeight: 2,
      fullPage: true,
      theme: "light",
      file: `screens/v/${screen}@2.png`,
    });
    await writeFile(
      path.join(kit, "basis-verify.json"),
      JSON.stringify({
        views: [
          {
            id: "v",
            screens: [
              { id: "a", shots: [shot("a")] },
              { id: "b", shots: [shot("b")] },
            ],
          },
        ],
      }),
    );
    for (const dir of ["screens/v", "actual/v"]) await mkdir(path.join(kit, dir), { recursive: true });
    await writeFile(path.join(kit, "screens/v/a@2.png"), png);
    await writeFile(path.join(kit, "screens/v/b@2.png"), png);
    await writeFile(path.join(kit, "actual/v/a@2.png"), png);
    const { execFile } = await import("node:child_process");
    const source = path.resolve(import.meta.dirname, "..", "server", "verify-kit");
    for (const file of ["compare.mjs"]) await writeFile(path.join(kit, file), await readFile(path.join(source, file)));
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) =>
        execFile(process.execPath, [path.join(kit, "compare.mjs"), ...args], { cwd: kit }, (error, stdout) =>
          resolve({ code: typeof error?.code === "number" ? error.code : 0, out: stdout }),
        ),
      );
    const one = await run(["--only", "v/a"]);
    assert.equal(one.code, 0, one.out);
    assert.match(one.out, /PASS\s+v\/a@2\.png/);
    assert.doesNotMatch(one.out, /v\/b@2/);
    const all = await run([]);
    assert.equal(all.code, 1);
    assert.match(all.out, /MISSING\s+v\/b@2\.png/);
  } finally {
    await rm(kit, { recursive: true, force: true });
  }
});

test("a kit can go into a folder of its own, which its texts name", () => {
  assert.equal(kitFolder("basis-verify/web-12"), "basis-verify/web-12");
  assert.equal(kitFolder(String.raw` basis-verify\WEB-12/ `), "basis-verify/WEB-12");
  assert.equal(viewKitFolder("billing"), "basis-verify/billing");
  for (const bad of ["", "/abs", "C:/x", "a/../b", "..", "a/./b", ".hidden", "a b", "a/b/c/d/e", "a//b"]) {
    assert.equal(kitFolder(bad), null, bad);
  }
  const views = [{ id: "web-12", title: "WEB-12 Sign in", screens: [{ id: "form", label: "Form" }] }];
  const folder = "basis-verify/web-12";
  assert.match(promptFile("Acme", "basis-design 0", views, folder), /`basis-verify\/web-12\/views\/web-12\.md`/);
  assert.match(agentsParagraph(folder), /basis-verify\/web-12\/PROMPT\.md/);
  assert.match(kitPrompt({ views, zip: false, folder }), /into `basis-verify\/web-12\/`/);
  // One skill serves every kit under basis-verify/, so it names the folder of none.
  const skill = skillFile(views, folder);
  assert.match(skill, /Each verification kit is a folder under `basis-verify\/`/);
  assert.match(skill, /node basis-verify\/<kit>\/capture\.mjs design/);
});

test("kits written into folders of their own leave each other alone", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "basis-kits-"));
  try {
    const kit = (name: string) => [
      { path: "basis-verify.json", data: strToU8("{}") },
      { path: "PROMPT.md", data: strToU8(name) },
    ];
    const first = await writeVerificationKit(kit("a"), project, { folder: "basis-verify/web-12" });
    const second = await writeVerificationKit(kit("b"), project, { folder: "basis-verify/web-13" });
    assert.ok(first.ok && second.ok);
    assert.equal(first.dir, path.join(project, "basis-verify", "web-12"));
    assert.equal(await readFile(path.join(project, "basis-verify", "web-12", "PROMPT.md"), "utf8"), "a");
    assert.equal(await readFile(path.join(project, "basis-verify", "web-13", "PROMPT.md"), "utf8"), "b");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
