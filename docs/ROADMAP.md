# Roadmap

The plan a `/loop` works through, one step per round. Each round picks the first unchecked step, builds it,
verifies it, ticks it here, and commits and pushes. Decisions made along the way go in the log at the end, so
the next round (and Lucas) can see why.

## Goal

Round 2 (from 2026-10-18) has three aims, in this order of priority:

1. **Better work from the agent.** The agent sees what it built, and the fix loop catches layout faults, unstable
   views and values outside the scales, the way it already catches contrast and accessibility.
2. **More the service can do.** The verification kit tells the implementing agent what to build as well as how it
   must look, the design can be shared as a static site, versions can be compared visually, the product's running
   pages inform the import, and tokens can go back into the product repo.
3. **Packaging.** Several starter templates, templates from a folder, git or npm, a Tailwind template, and
   headless commands for CI. Evals measure whether changes to the brief make the agent better.

## Decisions from Lucas

- 2026-10-18, round 1: a project links a product repo the agent reads and never writes; tokens go into
  `design-system.json` and the components are restyled to resemble the repo's; views are built from the patterns;
  quality checks run in the fix loop; commit and push each verified step and make decisions while the app is early.
- 2026-10-18, round 2: work through every step below without asking. Where a decision is needed, take it and log
  it. Commit, push and run real agent turns as needed. Lucas publishes to npm himself; never run `npm publish`.
- 2026-10-19, after testing: the steps under "From Lucas' testing" come first, one at a time, each committed and
  pushed. A project folder inside a product repo links that repo by itself. Several projects run at once with
  their agents working in the background while one is shown. Threads are separate chats in one project whose turns
  take turns, not parallel worktrees.

## How each round works

The loop's session is an orchestrator: each round it hands the first unchecked step to one subagent and checks
the result before the next round. The subagent:

1. Reads this file, `docs/DEVELOPMENT.md` and the code the step names, then builds the step with narrow diffs that
   match the surrounding code. Tests for server, shared and parsing logic.
2. Runs `npx prettier --write src server test shared template` and `npm run check`, which must pass, and
   `npm run test:e2e` when the step touches the UI.
3. Verifies in the browser on a throwaway instance, never on Lucas' workspace, project list or the Basis he runs
   on port 5320: `PORT=5330 BASIS_WORKSPACE="$TEMP/basis-test-ws" npx tsx server/index.ts`, or
   `PORT=5330 BASIS_HOME="$TEMP/basis-test-home" npx tsx server/index.ts` for anything about projects. Runs a real
   agent turn when the step changes what the agent does or sees. For a product repo it uses a small fixture repo
   under `$TEMP` (Tailwind config, CSS variables and a few components), never one of Lucas' real repos.
4. Updates README and `docs/DEVELOPMENT.md` where behaviour or architecture changed.
5. Ticks the step, adds its decisions to the log, commits (the message says why, the body lists the changes, no AI
   attribution) and pushes to `main`. Stops the test instance and removes its scratch folders.
6. Splits a step that turns out bigger than one round into smaller steps here, and does the first one.

The orchestrator checks that the commit exists, CI is green and the step is ticked, then starts the next round.
The loop stops when every step is ticked, or when something would lose data or cannot be got past; then it reports
to Lucas.

## Round 1 (done)

Contrast check, accessibility check of the live gallery, contracts for patterns, linking a product repo, bringing
in its design system, creating a project from a repo, repo context in every turn, the Views page, New view, views
in reviews, and the verification kit. The decision log below has the details.

Still open from round 1, for Lucas: **what deviation is acceptable** when something cannot be reproduced exactly
(fonts across machines). Decide after trying the kit on a real feature at work. Real photos are handled since
2026-10-19: they may differ inside boxes that must match exactly (see the log).

## Round 2 steps

### From Lucas' testing

- [x] **Reading the product repo without prompts.** Claude Code is only given the workspace as `cwd`
      (`openSession` in `server/agent.ts`), so its shell commands in the linked repo (`cd … && git ls-files`, `ls`,
      `find`, `grep`) and searches without a path always ask. Pass the linked repo as `additionalDirectories`, and
      rebuild the session when the link changes. A project whose folder sits inside a git repo links that repo by
      itself (read only, as a linked repo). On Windows the folder dialog is the old tree picker; use the modern one
      (`IFileOpenDialog` with `FOS_PICKFOLDERS`) in both Windows PowerShell and pwsh. Done when: a real Claude turn
      in a project inside a fixture repo reads the repo with shell commands and searches without a prompt, and
      writes there are still refused.
- [x] **The preview waits for the turn.** Mid-turn states (a half-written file, an import of a file not written
      yet) leave errors that outlive the turn: the preview never reports an empty list after a reload, so the old
      list stays in the chrome and the server; a new specimen whose first load failed stops taking HMR updates; and
      the fix loop reads the report after a fixed 1500 ms. Hold the preview's code updates while a turn runs (a
      plugin in the preview's Vite), reload the gallery once when it ends, have the preview report its errors on
      `ready` and the chrome reset them, and let the fix loop wait for a report from after the reload. The agent's
      screenshots keep showing its work mid-turn. Done when: a real turn that creates a new view in several writes
      ends without stale errors, and the gallery shows the view without a manual reload.
- [x] **Images in the kit.** Exceptions can name elements by `selector` (the kit works out their boxes per shot on
      both sides and still checks the boxes' size), views use local placeholder images marked `data-basis-media`
      (the brief says so), and a check reports remote image URLs in views. Done when: a view with a photo passes
      the kit with a selector exception, and a remote image is reported.
- [x] **A prompt for the implementing agent.** Merges "Implementation notes in the kit" and "A skill for the
      implementing agent" below: the kit carries `PROMPT.md` (goal, each view's screens, flow, components and
      tokens, the capture and compare loop, the exception rules, when to stop) and the Export tab gets "Copy prompt",
      which tells the agent to read it. Done when: an agent given only the copied prompt in a fixture repo finds the
      kit and runs the loop.
- [x] **Several projects at once.** Projects stay open while their agent works after you switch away; the project
      menu shows which are busy, done or waiting for an approval. Each open project gets its own preview port, the
      screenshot tool names its project, and server messages carry the project. Idle projects close after a while.
      Done when: two projects run turns at the same time and each ends with its own history entry and no crossed
      messages. (Split: the headless page is the next step.)
- [x] **Preview checks for projects in the background.** While no tab shows a project whose agent works, a headless
      page (in the project's screenshot browser) hosts its gallery the way the chrome does and reports its render
      errors and checks, so the fix loop's wait for the reloaded gallery and its checks works there too; it closes
      when a tab shows the project again or the agent is done. Done when: a turn in a project in the background
      that leaves a render error and an accessibility finding gets both back in its fix loop.
- [ ] **Threads in a project.** Several chats per project, each its own agent session, listed in the chat panel;
      their turns queue across threads so history and reviews stay consistent. Done when: two threads in one
      project keep separate conversations across a restart.

### The agent's work

- [x] **Capture any specimen.** `capture.html` gets a third mode, `?specimen=<id>&theme=light|dark`, that renders
      one component's or pattern's specimen alone at the width the browser gives it, the way the gallery renders
      it, without the gallery's chrome. A server module (beside `server/capture.ts`) captures a specimen or a view
      screen from the live preview server at given widths and themes, keeping one browser open and closing it after
      a minute idle. Done when: a script against a throwaway instance captures `Button`, a pattern and a view
      screen in both themes, and a unit test covers the parts that do not need a browser.
- [x] **A screenshot tool for the agent.** Basis gives each session its own MCP server (`mcpServers` in
      `server/agent.ts`, empty today) with a `screenshot` tool: `{ target, screen?, widths?, theme? }`, where
      target is a specimen id or a view id, returning PNGs (at most four per call, tall pages cut at a fixed height
      and said so). Decision: stdio transport, since ACP requires every agent to support stdio MCP servers. The
      server is a small dependency-free script that speaks MCP's JSON-RPC and forwards calls to Basis over HTTP on
      127.0.0.1 with a secret made at each start (passed in the server's env), and Basis auto-approves its own
      tool. The brief says when to look: after a visual change and before opening a review, at the narrowest width
      and in both themes. Done when: a real Claude turn calls the tool and acts on what it saw, and Codex is tried
      if it is logged in (log the result either way).
- [x] **Layout checks.** A preview check beside `src/preview/a11y.ts`, over the same marked demos, through the
      same checks channel (only findings a turn introduced reach the agent). Three rules: content wider than its
      frame at the frame's width (horizontal scroll), text clipped by `overflow: hidden` without `text-overflow` or
      line clamping, and interactive targets smaller than 24 by 24 CSS pixels (WCAG 2.5.8; inline links in running
      text are exempt). Findings name the section, theme, width and an example element. The starter template must
      come out clean; fix the template where it does not. Done when: pure parts have tests, a deliberately broken
      specimen shows each finding, and the agent fixes one in a real turn.
- [x] **Keep Codex out of the user's own setup.** Claude's design agent no longer reads the user's Claude Code
      setup (`settingSources: []`), but Codex still loads `~/.codex/skills/` and the user's AGENTS.md during design
      turns (found while building the screenshot tool). Start Codex so it reads only what Basis gives it, the way
      Claude is started, keeping the user's login. Done when: a real Codex turn no longer lists or reads the user's
      skills, and still works with the screenshot tool.
- [x] **Codex reads without a prompt each.** Since Codex runs in Basis' own home without a sandbox on Windows, it
      asks before every command, reads included, which makes a design turn tedious. Approve Codex's read-only
      commands automatically when every path they touch is inside the workspace or the linked repo, as Claude
      Code's reads are; Codex's approval request carries neither the command's kind nor its path, so take them
      from the tool call reported just before it. Anything that writes, runs scripts or reaches outside still
      asks. Done when: a real Codex design turn reads files without prompts, and a command outside the workspace
      still asks.
- [x] **Stable views when they are built.** After a turn that changed files in `views/`, the server captures the
      changed views' screens twice at their first width with the step-one module, and reports a screen that renders
      differently as a problem in the fix loop ("Screen X of view Y renders differently each time; look for clocks,
      random values or animations that do not settle"). Decision: a problem rather than a check, since such a
      screen can never pass the kit. Done when: a view with `Date.now()` is reported and a real turn fixes it.
- [ ] **Values outside the scales.** Like `shared/fixed-colors.ts`, find literal lengths in the agent's
      stylesheets for padding, margin, gap, border-radius and font-size where the design has a scale for them.
      Allowed: 0, 1px and 2px (hairlines), percentages, viewport units, `auto` and values derived from tokens.
      Findings go with the fixed-colour findings in the fix loop. The starter template must come out clean. Done
      when: tests cover the parser, and a real turn replaces a literal with a token.

### What the service can do

- [x] **Implementation notes in the kit.** Built as part of "A prompt for the implementing agent" (see the log).
      For each view the kit gains `views/<view>.md`: its screens (id, label,
      the shots), the flow (which screen's `go()` leads where, from literal calls in the source), the components and
      patterns it imports from the workspace, and the tokens in `design/design.json` it can use. Decision: written
      from the source without an agent turn, so the notes always match the screenshots. The README and the manifest
      point at them. Done when: tests cover the source reading, and the kit built from the starter view has notes
      that are correct.
- [x] **A skill for the implementing agent.** Built as part of "A prompt for the implementing agent" (see the log).
      The kit carries `SKILL.md` (Claude Code's skill format) with the
      capture, compare, read the diffs, fix and repeat loop, and the README gives the same text as a paragraph for
      AGENTS.md. Writing the kit into a folder gets a checkbox that also installs the skill as
      `.claude/skills/basis-verify/SKILL.md` there; Basis overwrites that file only when it carries Basis' generated
      marker. Done when: `claude -p` in a throwaway fixture product repo with the kit, asked to build the starter
      view's first screen, finds the skill, runs the loop and reports the result; log what it did.
- [ ] **The gallery as a static site.** A new Export tab builds the gallery (all pages, both themes, Show at
      widths, clickable views) as static files, without the bridge, reviews, history, checks or the agent, to a
      zip or a folder, like the kit's static copy of the design. Done when: the built site served by a plain static
      server shows every section without errors, and an e2e test opens it.
- [ ] **Compare two versions.** From the history menu, compare a past entry with the current one: Basis captures the
      specimens and view screens whose files differ between the two, renders the past side from its snapshot (the
      same mechanism the review view uses), and shows each changed item with before, after, a diff image and the
      share of pixels that changed. Reuse the kit's PNG comparison rather than writing a second one. Done when: two
      entries that differ in a button and a view show both, and unchanged items are not captured.
- [ ] **The running product informs the import.** Linking a repo and creating a project from one get an optional
      field for the product's address (a local dev server or a staging URL) and a few paths. Basis captures those
      pages at 1440 and 375 into `.basis/product-shots/`, and the import turn tells the agent to look at them
      alongside the code. Decision: pages a login hides are out of scope for this step. Done when: against a
      fixture product served locally, the agent's import mentions what it saw in the shots.
- [ ] **Tokens back into the product repo.** A guided turn from the project menu: the agent writes the repo files
      it would change (token and theme files only) under `.basis/sync/` in the workspace, at their repo-relative
      paths, with `sync.json` listing each file and why. Basis shows each change as a diff against the repo; Apply
      writes it into the repo after checking the repo file has not changed since the turn started, and never
      deletes. The agent still cannot write to the repo; only the user's Apply does. Done when: on a fixture repo
      the user-applied change updates its CSS variables or Tailwind theme correctly, and a repo file changed in the
      meantime is refused.

### Packaging

- [ ] **Templates as named packages.** Move `template/` to `templates/app/` with a `template.json` (id, name,
      description, version), keep history and `CHANGES.md` per template, and record `{ id, version }` in a
      workspace's `.basis/template.json` (a workspace without an id is `app`). No behaviour changes in this step;
      the package's `files`, scripts, tests and docs follow the move. Done when: `npm run check` and the e2e tests
      pass, and an existing workspace starts and updates as before.
- [ ] **A minimal template and a picker.** A second template, `minimal`: the base components and an empty Views
      page, no patterns. The create dialog lets the user choose the starter, with `app` the default. The contract
      checks apply to what a template contains. Done when: a project made from each template starts clean (no
      problems or findings), and an e2e test creates one from `minimal`.
- [ ] **Templates from a folder, git or npm.** The picker's "Other" takes a local folder, a git URL or an npm package
      name. Basis fetches it (`git clone --depth 1`, or `npm pack` into a temp folder, which runs no package
      scripts), checks it has a `template.json` and only the template folders, and copies it into the new workspace.
      A local-folder template is followed for updates on start like the built-in ones; git and npm templates are
      copied once. Done when: each source works against a throwaway template, and an invalid one is refused with a
      reason.
- [ ] **Headless commands.** `basis kit [--project <name>] (--out <folder> | --zip <file>)` and
      `basis check [--project <name>]`, which runs the type check, contracts, design problems and the preview's
      checks in a headless browser, prints the findings and exits 1 when there are any; `basis --help` lists them.
      They start what they need on free ports, without the UI, and only read the workspace, so they work while
      Basis runs. Done when: both work against a throwaway project, and CI runs `basis check` on the starter
      template.
- [ ] **Evals for the brief.** `npm run eval` (not shipped in the package) starts a throwaway instance, creates a
      project from a fixture repo committed under `test/fixtures/`, runs a few fixed tasks with the real agent over
      the bridge (restyle the buttons in both themes, a new view from a ticket, the import), and scores each: what
      the checks still report, fix-up turns, time, and screenshots of the result, in a markdown report under
      `eval-results/` (ignored by git). Done when: it runs end to end once and the baseline is in the decision log.
- [ ] **A Tailwind template.** Decision: build it, since many products use Tailwind and components written in the
      product's own stack can move into it directly. Tailwind v4 through its Vite plugin, used only for workspaces
      made from this template; the design's roles become `@theme` variables so utilities like `bg-primary` follow
      the theme; the fixed-colour and scale checks understand arbitrary values (`p-[13px]`, `bg-[#fff]`). Split
      this step first if it is bigger than a round. Done when: a project from it starts clean, the agent restyles
      a component in a real turn, and the kit works for one of its views.

### Release

- [ ] **Prepare 0.3.0.** Bump the version, write the release notes to `$TEMP/basis-release-notes-0.3.0.md` in the voice of the 0.2.0
      notes, check CI is green on all platforms, and report to Lucas. Do not publish, tag or release; Lucas
      publishes and asks for the tag.

## Decision log

- 2026-10-19: Preview checks for projects in the background. `server/background.ts` runs a project's gallery in a
  page of its screenshot browser (`Screenshots.withPage`, so the browser stays open while it runs and the one
  browser per project serves screenshots, the stable-views check and this) while no tab shows the project and its
  agent works; `OpenProjects.update` tells each project whether a tab shows it (`setShown`), so it starts when the
  user switches away mid-turn and stops when they come back or the agent is done. The page plays the chrome:
  it embeds `preview.html` with the chrome's origin as parent, which the preview's CSP and its parent check
  already accept, sends the view on every `ready` and passes on errors and checks, reset with each document as
  the chrome resets them, so the reload at the end of a turn and the fix loop's wait for its generation work
  unchanged. Decision: the host page is served by the chrome server (`/background.html?port=`), not made up in
  the browser with `page.route`, which was tried first: Chromium's local network access checks treat a routed
  page as public and refused its frame from localhost (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). The page
  holds nothing secret, cannot reach the bridge, and opened in a tab shows a gallery that reports nowhere. The view
  is the light theme without the review, on the page with most of the files the turn changed (`pageForFiles`,
  the design system page for token-only turns), since the user's own page is a chrome preference the server does
  not know; the gallery's copy in the other theme checks dark and 375px as in a tab. Until the page first reports
  it counts as a gallery still loading (generation -1, checking), so a fix loop that starts right after a switch
  waits for it rather than taking an empty report. A browser that cannot start is tried once per busy spell and
  said once on the console; the fix loop then leaves the preview out, as before. Verified with unit tests
  (`test/background.test.ts`: the page choice, the report parsing, reports from start to stop and none from a
  stopped page, no retry of a failed browser, `setShown` from `OpenProjects`), an e2e test (a turn in a project
  the tab left writes a specimen that throws and one with an unnamed button; its fix-up report names the render
  error and the accessibility finding, and the fix-up turn leaves nothing to report), and with a real Claude turn
  in a project in the background on a throwaway instance (driven over the bridge, the tab on another project): the
  agent wrote a throwing Probe specimen and an unnamed button as asked, Basis' report named "Probe section: probe
  failure" and button-name in light and dark, and the agent fixed the throw and left the button, saying so, in a
  second commit nine seconds later. With the routed page, the stand-in agent's turn had ended with "the preview did
  not report after the turn", which is how the refused frame showed.

- 2026-10-19: Several projects at once, split in two: this step keeps projects open and apart, and "Preview checks
  for projects in the background" adds the headless page, which is a piece of its own (a host page that renders the
  gallery as the chrome does, in the project's screenshot browser). `server/open-projects.ts` (`OpenProjects`) holds
  the open projects; a tab shows one, and switching shows another in that tab without closing the one it left, so
  its agent goes on. Two tabs can show different projects; one tab switching never moves the other. The project
  shown last stays `active` in the list and opens at start. Each project's messages go only to the tabs that show
  it and carry its id (`projectId`), and the chrome drops any tagged with another; the chrome tags what it sends
  with the project of the workbench that sent it (in `App`, not in the bridge, since the bridge learns of a new
  project before React unmounts the old workbench, whose gallery may still report), and the server routes a tagged
  message to that project even when the tab has moved on, so a prompt or a permission answer sent during a switch
  is never crossed; preview reports are taken only from tabs that show the project. Ports: the first project open
  keeps `PORT + 1` (or `BASIS_PREVIEW_PORT`), the others get a free port from the system rather than the next ones
  up, which could run into another Basis (a test instance on 5330); the preview server listens before Vite is set
  up, so the port is known for the screenshots. The CSP needed no change: `frame-ancestors` names the chrome, and
  the chrome takes the port from the `hello`. Vite caches are per slot (the lowest free number when a project
  opens: `preview`, `preview-1`, …), so their number stays the number of projects open at once, not every project
  ever opened. The screenshot tool's URL names its project (`/agent-tools/<project>/`), with the one secret, so an
  agent always photographs its own project. Statuses: `working` (the agent is busy), `waiting` (a permission
  request waits; `AgentHost.waiting`, set before the chat item goes out), `done` (a turn ended while no tab showed
  the project, kept until one does, also after it closes); the menu labels the rows, and a dot by the project's name
  says so with the menu shut, red and blinking for waiting since that agent is stuck. Switching, New project and
  Open folder no longer wait for the agent; a copy of a project still does, since a copy mid-turn could take
  half-written files, and a project that is shown, working or waiting cannot be removed. Idle projects (no tab, not
  working, not waiting) close after ten minutes (`IDLE_CLOSE_MS`): long enough to look at another project and come
  back, short enough that a day's visits do not each keep an agent, Vite and a browser running; reopening resumes
  the agent's session as before. The chat draft is per project (`basis:draft:<id>`); the old global draft is left
  alone. Several Claude Code processes make the transient OAuth refresh failure more likely; it is noted under
  Gotchas, and no retry was added. Codex agents of several projects share Basis' Codex home, as several Codex
  sessions share `~/.codex`; not tried with two Codex turns at once. Until the next step, a project in the
  background gets no preview reports, so its fix loop leaves out render errors and checks, as it did for a turn
  with no tab open (Known limits). Verified with unit tests (`test/open-projects.test.ts`: one open per project
  however many ask, slots, done only when unseen, statuses reported once per change, idle closing that spares
  shown, working and waiting projects, a failed open freeing its slot; the per-project tool route), two e2e tests
  with a home of their own (`test.use({ home: true })`; the stand-in agent got `E2E-SLOW` and `E2E-ASK`): two
  projects with overlapping turns each end with their own chat and history entry and the other's message absent,
  the button says the other finished, and a project waiting for an approval shows outside the menu and can be
  answered after switching back; and on a throwaway instance with real Claude turns: a project "Second" created
  beside "Basis", then a turn in each started seconds apart (each taking three screenshots and changing a motion
  token), with the menu showing Basis working while Second was shown. Both ended with their own commit
  (19:39:12 and 19:39:20), each chat held only its own prompts, its greps named its own workspace, its
  screenshots showed its own tokens (Second's agent saw its own 14px radius), and the button said "Basis finished
  in the background". Second's preview ran on a free port beside Basis' on 5331.

- 2026-10-19: A prompt for the implementing agent. This step also builds "Implementation notes in the kit" and
  "A skill for the implementing agent", which are ticked with a pointer here rather than removed, so their
  original wording stays readable. What Lucas asked for, a prompt "with a link or a tool call", is a file in the
  kit plus Copy prompt: the kit carries `PROMPT.md` and the Export tab copies a few lines that send the agent
  there. A live MCP server for implementing agents (asking Basis for a screen's shots, notes or a comparison while
  Basis runs) is out of scope for now and a possible later step; the kit works without Basis running, in CI or on
  another machine. Notes live in `views/<view>.md`, one per view, and `PROMPT.md` lists the views with their
  screens and points at the notes, since the copied prompt names one view and a kit with many views would make one
  long file. They are written from the source without an agent turn (`server/verify-notes.ts`), as the notes step
  decided: the screens and their shots from the capture list, the flow from literal `go("id")` calls in each
  screen's render function (or inline render) and the file's top-level functions it names, with the text of the
  element that calls it ("Invite member") and whether it passes data; the names it imports from components,
  patterns and other files, resolved through the barrels by name with `reach.ts`'s helpers (now exported); its
  images; and the tokens the files it reaches read, with the tokens their values refer to (`--button-radius` brings
  `--radius-md`). Scales get a table with the path in `design.json` and the value (light / dark for colours);
  component tokens are named by group only, since a file with several components (`Display.tsx`) brings all their
  tokens and listing each would mislead. `globalTokenGroups` now also returns each group's path. Added beyond the
  steps' text: `source/`, a copy of the files each view reaches (21 files for the starter view), since exact text,
  structure and data are what a pixel match needs and the built JavaScript in `design/` does not show them; and
  `--only <view>[/<screen>]` for `compare.mjs`, as `capture.mjs` had, so an agent building one screen is not told
  the rest of the kit is missing. `PROMPT.md` and `SKILL.md` share one text for the loop, the image and exception
  rules and when to stop (`server/verify-prompt.ts`); `PROMPT.md` adds the goal, where things are, the views and
  how to build one (a URL per screen, the design's data from seeds or fixtures, never constants in shipped code),
  and the README gives a paragraph for `AGENTS.md`. Paths start at the repo's root (`basis-verify/…`) for a written
  kit and a zip alike, since the zip's top folder is `basis-verify/`; the copied prompt for a zip says it was
  unpacked at the root and to read paths from wherever it is otherwise. Acceptable deviation is still Lucas' open
  decision, so the prompt says 0% with no `--max-diff` or tolerance unless the person says so, and to stop and
  report after three rounds without progress, when the rest needs shared code, global styles, the product's
  tokens or a font, when a screen has no URL or its data cannot be shown, and on unstable shots. The skill is a
  checkbox next to Write kit (remembered per project, off by default since it writes outside `basis-verify/`); it
  goes to `.claude/skills/basis-verify/SKILL.md` and replaces a file there only when it has Basis' marker line
  (after the frontmatter, which must come first), and the Export tab says when it left one alone. Copy prompt shows
  after a kit is built in the open dialog, with the prompt visible and a view picker when there is more than one;
  the label turns to Copied at once, and if the browser refuses the clipboard (the desktop app's browser pane
  does) the text is selected with a note. Verified with unit tests (the flow with helpers and inline renders, the
  starter view's flow, names, files and variables, a helper file and an image, token rows, the notes, the shared
  loop and the skill's frontmatter and marker, the copied prompt, installing and keeping the skill, `--only` in
  `compare.mjs`), the e2e kit test (the new files in the zip, the prompt, Copy prompt), and on a throwaway
  instance: written into a fixture repo (plain HTML, CSS variables, a Tailwind config) with the skill installed,
  and as a zip with a second view to check the picker. Then `claude -p` (Claude Code 2.1.296) in the fixture, given
  only the copied prompt plus "For now, build only the view's first screen", in `acceptEdits` mode with Bash
  allowed only for the two scripts, `npm run dev` and `ls` (a first try in `dontAsk` mode found the kit but could
  not write, as `Write(./**)` did not match its Windows paths). It invoked the installed `basis-verify` skill first,
  read `PROMPT.md`, the notes and the source, captured the design with `--only team-members/list`, looked at the
  expected images, wrote `/members` with the product's own `.btn` and tokens, the members as a fixture JSON loaded
  by a script, page-only styles and `targets.json` with a `waitFor`, started the dev server, and ran capture and
  compare five times. 375 and 768 passed at 0%; 1440 stayed at 8 pixels of antialiasing at the table's rounded
  corner, so after three rounds without progress it stopped as the prompt says and reported each shot, what it
  built, that it added no exceptions, an unstable 375 capture it saw twice (Basis built a second kit at the same
  time, which may explain it), and asked whether to accept the difference or set a tolerance rather than setting
  one. Writes and scripts outside the fixture were refused. 48 turns, $1.55.

- 2026-10-19: Images in the kit. A photo can never match pixel for pixel, so the kit compares where it is rather
  than what it shows. An exception may name elements by `selector` (one for both sides, or `{ design, app }` when
  the two need different ones), and elements marked `data-basis-media` are left out of every shot without an
  exception; `capture.mjs` measures the matched elements after each shot (`getBoundingClientRect` plus scroll,
  widened outward to whole pixels, empty boxes skipped) and writes them to `<shot>.boxes.json`, and Basis writes
  the same for `screens/` with the marker only, so a kit compared against its own screenshots still knows the
  boxes. `compare.mjs` leaves out every matched box on both sides and fails the shot when the counts differ or any
  box moved or changed size: exactly by default, since a box that is off by a pixel moves something around it
  too and the kit's target is 0%; `--box-tolerance <px>` is there for whoever decides otherwise, like
  `--tolerance` for colours. A missing selector on one side (an exception added after capturing) fails with "run
  capture.mjs again" rather than passing. The implementation marks its own images with the same attribute: one
  inert attribute was simpler than a second selector list for the media rule, and the `{ design, app }` form
  covers anything else. `region` exceptions work as before, and a kit from before has no `media` entry in its
  manifest, so nothing is left out by the marker there. Placeholders live in `views/assets/`, imported by the view
  (`import photo from "./assets/x.svg"`): Vite serves them in the preview and builds them into `design/assets/`
  (or inlines small ones), so the kit carries them with no copying of its own; `.basis/env.d.ts` declares image
  modules so the type check passes, and `reach.ts` counts images as files without imports so a changed
  placeholder reaches its views. The brief asks for SVG placeholders the agent writes, in a fixed box, marked and
  never from another site; the guidelines' Screens and flows section asks for fixed image boxes and alt text.
  Remote images are found in the capture pass, not in the source like fixed colours: a `request` listener in
  `takeShot` lists image and media requests to another origin, which catches URLs in data files, `srcset` and CSS
  that a source scan would have to guess at, and leaves fonts alone. The stable-views check reports them as
  problems (a section of their own, at most three URLs per screen), and the kit build lists them in the Export
  tab and in the manifest's `remoteMedia`. The static servers now know `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`
  and `.woff`. Verified with unit tests (exclusions, mismatches, tolerance, missing and invalid selectors, the
  box script in a VM, `isRemoteMedia`, the remote finding, an image in reach) and end to end on a throwaway
  instance: a Shop view with a placeholder SVG marked as media built into a kit written to a fixture folder (the
  SVG landed in `design/assets/`, each shot had its boxes file, and the Export tab named the one shot of a planted
  view that loads `https://images.example.com/summer.jpg`); a fixture app serving the same screen with another
  photo (23% of the pixels differ) passed `compare.mjs` at both widths, with the marker and again with an
  exception `"selector": "img"`, and failed when the photo's box was 4:3 instead of 3:2 ("element 1 of
  "[data-basis-media]" is 327x246 at 24,114, in the design 327x219 at 24,114", the box blue in the diff). Two real
  Claude turns: asked for a product page with a large photo, Claude wrote `views/assets/running-shoe.svg` and an
  `img` marked `data-basis-media` with `aspect-ratio` and `object-fit: cover` (it had read the planted Shop view,
  which does the same); asked only to rename the heading of the planted remote-photo view, it renamed it, the fix
  loop reported the remote URL, and the fix-up replaced it with a local SVG of the same size, marked.

- 2026-10-19: The preview waits for the turn. Each agent run holds the preview from the start to the end of `runTurn`,
  so a fix-up turn holds again and the alternatives' takes each hold for their own turn; one hold over a whole prompt
  was ruled out, since the fix loop has to see each run's result in the gallery to report what it left broken. The
  hold is `PreviewHold` (`server/hold.ts`): a `hotUpdate` hook in the preview's Vite, ordered `post` so it also sees
  the importer the specimen glob adds for a new file, returns no modules. Vite clears a changed file's transforms
  before that hook, but the glob's importer for a new file only in the update it no longer sends (a fresh page
  would not see the new specimen), so the hook invalidates the update's modules itself, as Vite would; the
  agent's screenshots and the stability check, which load `capture.html` fresh, see the files as they are. Tokens
  and the review wait as well, the latest `design` and `review` message each: the gallery shows one state, the one
  before the turn, and a half-written `design-system.json` no longer flashes as a problem; live token feedback
  mid-turn is what that costs, and the agent writes tokens in one go anyway. A tab opened mid-turn gets the live
  state in its hello, which matches the code it loads fresh. When the turn ends and anything it holds changed,
  `basis:release` reloads the gallery once (only `preview.html` listens; its copy in the other theme goes with it,
  and capture pages never reload mid-capture), back to the section at the top and the offset into it, since a
  progressively rendered page defeats the browser's own scroll restoring; picks and a flow's screen start over.
  A reload rather than replaying the held updates, because a new specimen whose first load fails at the end of a
  turn would again stop taking the fix-up's updates. Every gallery document is served with its generation in a meta
  tag (`transformIndexHtml`), one more per reload, and says it with `ready`; it reports its errors (often none) and
  checks right after `ready`, and counts as checking until it first renders, and the copy in the other theme counts
  as running until it first reports. The chrome drops the old document's lists on `ready` and sends the generation
  with every report, and the fix loop waits for a report of the generation the release named (up to 10 s), then for
  the checks, instead of a fixed 1500 ms; it now waits when tsc found errors too, since a report from before the
  reload is stale, and when no report comes it leaves the preview's errors and findings out rather than send old
  ones. "Also changed", axe and the layout check needed nothing: they run in the reloaded document. Vite broadcasts
  every transform error to every page, so a capture page loading a half-done file would have put a compile error
  and the overlay into the held gallery; while held the gallery ignores `vite:error`, hides the overlay, and
  reloads at the release if it ignored one. The chrome shows "Changes show when the agent is done" on the preview
  while something waits. Verified with unit tests (the hold, the invalidation, the meta tag, the reports'
  generation, the fix loop's wait), an e2e test whose stand-in agent writes a view importing a file it writes
  1.5 s later (the note shows, the gallery has no trace of the view mid-turn, and after the turn it shows the
  view with no problems listed), and real Claude turns on a throwaway instance: asked for a "Release notes" view
  written specimen first and data file second, Claude wrote the two files and photographed both screens mid-turn
  (the screenshots showed its work), while the gallery stayed on the starter view with the note at the bottom;
  when the turn ended the sidebar listed the view, it rendered with its data, and no problem was listed, without a
  reload by hand. A second turn renaming a column reloaded the gallery onto the new column, still scrolled to the
  view.

- 2026-10-19: Reading the product repo without prompts. Claude Code gets the linked repo as a working directory
  through `_meta.claudeCode.options.additionalDirectories` (`sessionMeta` in `server/agent.ts`), not ACP's own
  `additionalDirectories`: both reach the same SDK option in claude-agent-acp 0.92.0, but codex-acp 2.2.2 merges
  ACP's field into its sandbox's writable roots and loads skills from those folders, and Codex ignores the
  `claudeCode` key. A changed link reaches the session before the next turn (`syncRepo`), never in the middle of
  one: `session/resume` of the live session with other directories changes the adapter's session fingerprint, so
  it rebuilds the session from its transcript and keeps its mode; a turn afterwards still counted the earlier
  messages and their steps. Measured with a fixture repo in real Claude turns (Claude Code 2.1.296 on Windows):
  before linking, `ls` and `cd … && git ls-files` in the repo both asked; after linking in the same session,
  `ls`, `ls -R | grep`, `find`, `grep -rn`, `cat` and `head`, Grep without a path, Glob with an absolute pattern and
  Read all ran without reaching the user, after unlinking `ls` asked again, and relinking ended that. Claude Code
  itself still asks for git that names another folder (`git -C <repo> ls-files`, `cd <repo> && git ls-files`) and
  for loops and variables, even in its working directories; Basis leaves those to the user rather than reading
  Claude Code's shell lines as it reads Codex's, since Claude Code's shell keeps its own folder between calls and
  Basis cannot know it. The brief now names plain `ls`, `find`, `grep` and `cat` as fine and says the others ask;
  with that, a fresh session asked to survey the repo "with your shell and your search tools" ran `cd … && find`,
  Read and Grep there with no prompt at all. Writes: Claude Code writes with its own tools (the adapter never
  goes through the client's `fs/write_text_file`), so with the repo as a working directory an edit there still
  asks in default mode, and Basis now refuses an edit-kind request inside the repo and outside the workspace
  without asking the user, with a notice in the chat; Write and Edit into the repo came back refused and the repo
  stayed unchanged. A shell write (`echo > file`) asks as every non-read command does. A project whose folder lies
  inside a git repo links it: `Projects.open` looks above the folder (a workspace is a repo of its own) for a
  `.git` and stops below the home folder, where a repo holds someone's settings. It happens once, when Open folder
  adds the folder, and is stored on the entry like a link the user made, so Unlink sticks and existing entries are
  left alone (Basis' own `workspace/` inside Basis' repo is not linked to it). No bring-in turn starts by itself:
  opening a folder is not a request to restyle the design, and the project menu offers Bring in its design for the
  linked repo as for any other; the Open folder dialog says the repo gets linked. The Windows folder dialog is now
  the Explorer-style `IFileOpenDialog` with `FOS_PICKFOLDERS`, through a small C# interop compiled by Add-Type in
  C# old enough for Windows PowerShell 5.1, keeping the hidden topmost owner, the title and the start folder.
  Verified by opening it from a script in both `powershell` and `pwsh` (the window has the address bar and
  breadcrumb of the Explorer-style dialog, not the tree picker's lone tree), choosing the start folder with OK,
  which printed its path, and cancelling, which printed nothing, and once through Browse… in the Open folder
  dialog of a throwaway instance. Unit tests cover `sessionMeta`, the refusal and what still asks, and
  `enclosingRepo`.

- 2026-10-19: Stable views when they are built. `server/stability.ts` runs in the fix loop after a turn whose
  changed files include one in `views/`; any other turn takes no screenshots, so the loop is as fast as before for
  them. What a turn changed comes from git: `Workspace` writes the working tree as a tree object when the turn
  begins (after a hand edit has its own entry) and when it ends, and `turnFiles` is the difference, which works
  the same in history and inside a review. The changed files are followed through the views' imports (`reach.ts`
  with the design unchanged), so a changed `views/team-data.ts` checks the views that import it; the capture
  list now carries each view's file to match them. `Screenshots.repeat` photographs every screen of those views
  at the first shot its flow asks for (the narrowest width in the first theme), twice, and the kit's own
  `compareImages` decides, with equal bytes as the quick case. Two plain captures a fraction of a second apart
  would miss a screen showing the time to the minute, or the date, most of the time, so the second capture runs
  in a page of its own whose `Date` is a day, an hour, a minute and a second ahead (an init script, so the shared
  context and the agent's screenshots keep the real clock; a string, since tsx may add helpers to a function's
  source). Math.random differs between loads by itself. The check starts when the loop does and runs while it
  waits for the preview to settle. A differing screen is a problem in its own section ("Screen "Overview"
  (overview) of view "Status" (views/Status.specimen.tsx) renders differently each time at 375px; look for clocks,
  random values or animations that do not settle."), with no pixel counts, so the text stays the same while the
  problem does. A screen that throws on the capture page joins the render errors with its message, unless the
  preview already reports the view's section by its title; a screen further into a flow is only rendered when
  someone clicks there, so usually nothing else reports it. Views found wrong are checked again after the fix-up
  turn whatever files it changed, and the list is cleared when the next prompt starts. When the browser cannot
  launch or the capture page does not settle (a compile error the preview reports anyway), the check finds
  nothing and logs its reason once per message. The brief now says when Basis captures views and that the second
  capture is a day later. Verified with unit tests (same pixels in different bytes, stable texts, left-out failed
  screens, the shifted clock in a VM, only reached views photographed, one warning for a missing browser, and
  `turnFiles` in history, in a review and with a hand edit before the turn), against a throwaway instance (a
  planted view with a clock to the minute, a screen that throws and one with Math.random came out as two unstable
  screens and one failure in 2.7 s with the browser starting; the three starter screens were stable in 2.0 s; a
  changed component took no screenshots), and with a real Claude turn: asked only to rename the heading of a
  planted Status view whose "Last checked at" came from `Date.now()`, Claude renamed it, said it had noticed the
  clock but left it as asked, the fix loop reported the Overview screen, and the fix-up turn replaced the time
  with a fixed "09:41"; the check after it found nothing, so the loop ended (18 s for the whole prompt).

- 2026-10-19: Codex reads without a prompt each. Logged from a real Codex turn first: the step assumed the approval
  request carries neither kind nor path, and that held only for the kind. Every request says `execute`, with Codex's
  own title ("Read file", "Run command") and, for a command Codex parsed as a single read, its path as a location;
  but its `rawInput` is the whole command line and folder, `{ command: "\"…\\pwsh.exe\" -Command 'Get-Content
  AGENTS.md'", cwd }`, the argument list Codex runs joined with POSIX quotes. The tool call reported before has
  less: no raw input at all for a read, and only the script without its shell otherwise. So Basis decides from the
  request's own command line, which is exactly what the approval runs, and requires Codex's locations to be
  readable too; nothing is remembered from the earlier report. `server/commands.ts` takes the line apart as POSIX
  words, finds `pwsh`/`powershell` with `-Command` (only `-NoProfile`, `-NoLogo` and `-NonInteractive` besides) or
  `bash`/`sh`/`zsh -lc`, and reads the script in a strict subset: plain words, quotes without expansions, `;`,
  `|`, `&&`, `||` and only the redirections that drop or merge errors. Everything else is refused: `$` in any form,
  backticks, parentheses, braces, `@`, `[`, `#`, `&`, other redirections, `--%`, newlines, and any character that is
  not printable ASCII, since PowerShell reads typographic quotes and dashes as quotes and dashes. Then every command
  of the script must be a listed read: Get-Content, Get-ChildItem, Select-String, Test-Path, Get-Item, Resolve-Path,
  Get-Location and the filters Select-Object, Sort-Object, Measure-Object, Format-Table, Format-List and Out-String
  (with Windows' aliases), each with an exact list of parameters, so `-Wait`, `-Stream`, `-FollowSymlink` and
  abbreviations ask; `rg` without `--pre`, `-z`, `-L`, `-f` or `--ignore-file`; `git status`, `diff`, `log` and `show`
  without global options other than `--no-optional-locks` and `--no-pager`, and without `--output`, `--no-index`,
  `--ext-diff`, `-O`, `--contents` or `--show-signature`; and in POSIX shells `cat`, `head`, `tail`, `wc`, `ls`,
  `grep` (no `-R`, no `-f`) and `find` (only tests that filter and print). Patterns are left out of the paths;
  every other argument that may name a file is resolved against the folder and checked like Claude Code's reads
  (inside the workspace, the workspace itself included, or the linked repo, after following links). A path is
  refused before resolving when resolving cannot be trusted: wildcards, `~`, UNC and device paths, a colon other
  than a drive's (`env:`, `HKLM:`, alternate data streams, `C:file`), and names ending in a dot or space, which
  Windows trims (`.. ` would be `..`). Arguments for `rg` and `git` from PowerShell are refused when PowerShell may
  pass them differently than written (arrays, empty, with `"`, and in Windows PowerShell 5.1 with spaces), and 5.1
  may not recurse, since its Get-ChildItem follows links. A shell started by path must not lie in the workspace or
  the repo, where the agent writes files. A request that also asks for network access or extra permissions has
  more in its raw input and asks. When the adapter has taken `bash -lc` off a POSIX line, its single quotes come as
  `'"'"'` that cannot be read back, so such a line asks. Only Codex's requests are read this way; Claude Code's
  shell commands still ask, since its own read and search tools cover what it needs. Verified with unit tests (the
  commands from the logged turn, and hostile ones: `cat a; rm -rf b`, `Get-Content x | Set-Content y`,
  `rg foo > out`, `..\..\` escapes, absolute paths outside, UNC paths, `$env:USERPROFILE`, `$(...)` and backticks)
  and on a throwaway instance with a copy of the Harbor fixture linked: a Codex design turn on the danger button
  read four times (Get-Content of three workspace files and the guidelines, `rg` in components, `rg --files` and
  Get-Content in the repo) with no prompt, a follow-up turn changed the weight, read the stylesheet again and took
  a screenshot with no prompt, while `Get-Content` of a file in `$TEMP` outside the workspace, the same file by
  `..\..\..\`, and `rg danger components > found.txt` each asked. A Claude turn on the same instance then read
  and searched without a prompt and still asked for `git status --short` in its shell.

- 2026-10-19: Keep Codex out of the user's own setup. Codex 0.160.1 (the adapter's) reads `AGENTS.md` from its home
  folder through a provider with no setting to turn it off, and `thread/start` cannot replace it, so config
  overrides alone could not do it; Codex now runs with `CODEX_HOME` set to `<BASIS_HOME>/codex`. That home also
  leaves out what Lucas' `~/.codex` holds besides skills: a `developer_instructions`, `danger-full-access` with
  `approval_policy = "never"` as defaults, three MCP servers, 22 plugins, memories, a Stop hook that runs a script
  from his skills, and command rules. Login: Codex keeps it in `$CODEX_HOME/auth.json` by default, and in the
  keyring under a key made from the home's path otherwise. Copying the file was ruled out, since a token one copy
  refreshes would leave the other with a refresh token already used; the Basis home gets a link to the user's file
  instead, renewed at every start (an old link goes first, so a logout is not undone). A symlink needs developer
  mode on Windows, so there it is a hard link, which stays the same file because Codex's file store truncates and
  rewrites `auth.json` in place (checked in its source; no rename). A unit test writes through the link and reads
  the user's file. Without a file to link, Codex runs in the user's home as before, so a keyring login keeps
  working; that case keeps their AGENTS.md and config and is noted on the console and under Known limits, and was
  not tried, since it would write into `~/.codex`. `CODEX_CONFIG` turns off what lives outside the home or comes
  with the login: `skills.include_instructions = false` (which hides `~/.agents/skills` too; Lucas has one),
  `skills.bundled.enabled = false`, and the `apps`, `plugins`, `memories` and `hooks` features. On Windows the
  new home has no sandbox: the unelevated one was tried and failed with "CreateProcessAsUserW failed: 5" because
  PowerShell here comes from the Store, and the elevated one is set up per home with an administrator prompt. So
  on Windows Codex now asks before every command, reads included, which closes the old limit that its sandboxed
  reads bypassed Basis' approval but costs one prompt per `Get-Content`; approving Codex's single-file reads in the
  workspace automatically is left for later (the approval request carries no kind or path, so it needs the tool
  call reported before). Earlier Codex sessions saved in a workspace's chat live in `~/.codex` and start over
  once, with the usual notice. Verified on a throwaway instance (`BASIS_HOME` in `$TEMP`): the auth link was a
  hard link and the user's `auth.json` was unchanged afterwards; asked from what it was given, Codex said it had
  no skills (none named check-work, plain-voice or write-like-lucas) and no home AGENTS.md, and its session file
  has no line of Lucas' AGENTS.md, no skills catalog and none of his MCP servers. In a design turn ("a slightly
  heavier label on the danger button, look at 375 in both themes") it read three files (each approved), edited
  the stylesheet, photographed Buttons with the screenshot tool (approved by Basis), opened a review and replied
  that the bold label reads clearly on both fills. A Claude turn on the same instance then photographed Buttons and
  described the new label. Also fixed in its own commit: the workspace test that failed once on Windows CI ("going
  back to an iteration", with an extra "Edit on disk") was a real race, where a hand edit's check still running when
  a turn began recorded the turn's first changes as the hand edit; `beginTurn` now marks the turn first and the
  settle handler records nothing once a turn has begun, with a test that reproduced it.

- 2026-10-19: Layout checks. `src/preview/layout.ts` runs in the same pass as axe over the same marked demos and
  reports as its own check, `Layout`, with the deciding parts (edges, cut lines, the example, the text) in
  `shared/layout.ts` under unit tests. A demo is judged in its frame: a Show at frame, now marked `data-frame` with
  its width, or the section or review pane around it. Overflow counts content past the frame's edge and also a box
  in the design that scrolls sideways, since that is what the starter view's member table did on a phone: the
  table scrolled inside DataTable's own scroller, so the page never scrolled, but the last column was out of sight.
  A box with scroll snapping counts as a deliberate strip and is left alone; the gallery's own wrappers and scroll
  areas (the button table at 375) never count, and neither does invisible content (a tooltip until hovered).
  Clipping is judged on the text's own line boxes, so a clipped avatar or visually hidden text is not a finding;
  an ellipsis allows sideways clipping and a line clamp vertical clipping. Target size is axe's own `target-size`
  rule (off by default in axe), enabled in the accessibility run, since axe runs one at a time and the rule already
  implements WCAG 2.5.8's spacing exception and the inline-link exemption; its findings go under Layout. Findings
  name the demo, theme and width ("at 375px", or "at the gallery's full width" for Fit, without a number, so a
  resized window does not change the text the fix loop compares) and an example element's start tag, one per demo,
  theme, width and rule. Phone width is always checked: the hidden copy in the other theme adds 375px to its frames,
  in the gallery and on a review's live side, so the user's own Show at choice changes nothing. The fix loop sends
  layout findings in their own section that points at the screenshot tool, and the brief and the guidelines (tables
  on a phone) mention the check. The limit on findings from the preview went from 40 to 60, since Layout adds up to
  15. The starter template came out with two faults, now fixed: DataTable stacks its rows as label and value pairs
  under a 600px container (select all and the sortable headers stay as a strip; explicit table roles keep it a
  table for screen readers once CSS changes its display), and the tooltip specimen gives its open tooltip room on
  the left. TEMPLATE_VERSION is 2 with a CHANGES.md section, because a workspace whose agent changed DataTable
  would otherwise keep a table that scrolls on phones, and the new check would list it for good. Verified: unit
  tests; an e2e test that the starter has no layout findings on any page and that a planted specimen shows all
  three kinds while an inline link, an ellipsis and a snapping strip do not; the whole starter clean at 375, 768
  and 1280 in both themes; and two real Claude turns on a throwaway instance. In the first ("a filter bar of
  chips, compact") Claude built a Chip component, looked at 375, made the bar one scrolling row with scroll
  snapping, saw its own negative margin push the strip past the edge, fixed that and opened a review; no finding
  reached the loop. Its fixes then ran inside that review, where the copy had added 375 only to gallery pages, so
  a phone fault there would have gone unseen; the review's live side gets 375 too now (checked by removing the
  snapping by hand: the 375 finding appeared in the review). In the second ("a small × on the selected chip") the fix loop sent it a target-size finding: the ×
  was 24px but its pinned pressed state scaled it to 22px. Claude named the `scale(0.92)` as the cause, removed it,
  marked the press with a darker circle instead, looked at 375 and 900 in both themes, and the checks came back
  empty. It also noticed the gallery's own state table scrolling at 375 and correctly left it alone. CI's e2e run
  on Linux then found the member list still scrolling at 375: with Linux's wider fonts the name button (avatar and
  name, no wrapping) no longer fit the value column of a stacked row. The first column now heads each stacked row at
  full width without its label, which fits on Windows with 1.5px of extra letter spacing too.

- 2026-10-19: A screenshot tool for the agent. Every session gets an MCP server named `basis` over stdio:
  `server/agent-tools-mcp.mjs`, run with Basis' own Node, which only speaks MCP and forwards `tools/list` and
  `tools/call` to `/agent-tools/` on the chrome server with a secret made at each start. The tool's definition and
  all the work live in `server/agent-tools.ts`, so the script never changes when a tool does. The tool takes
  `{ target, screen?, widths?, theme? }`: `target` is a specimen's or view's id or title (review.json names them by
  title, so the agent already knows those) and a screen goes by id or label. A view photographs the bare screen,
  as the kit does, and the text lists its other screens. Defaults are the narrowest width the target is shown at
  (375 for a specimen, the flow's narrowest for a view) in both themes. More than four images is refused with what
  to leave out rather than cut short, so the agent chooses what it misses. Full pages are cut at 2000 px (a
  Playwright clip, so nothing is decoded) and the text gives the page's whole height; a scroll offset was left
  out, since a wider width shows more of a tall specimen. Each image is preceded by a line naming its width and
  theme. Basis approves its own tool: Claude Code titles it `mcp__basis__screenshot`; Codex titles the call
  `mcp.basis.screenshot` but sends an approval without a title, only the call's id, so AgentHost remembers the
  ids of Basis' calls. The chat shows "Screenshot of <target>". The brief has a "Seeing your work" section: look
  after every visual change and before a review, at the narrowest width in both themes, and say what was looked
  at. Verified on a throwaway instance with a planted fault (every button capped at 84px with hidden overflow) and
  the prompt "the buttons look broken on phones": Claude found the tool through Claude Code's tool search, read the
  stylesheet, photographed Buttons at 375 in light, named the clipped labels "Save changes" and "Delete project"
  (which only the image shows; it never opened the specimen), removed the rule, photographed both themes and
  opened a review, with no permission prompt. Codex, after the approval fix, photographed at 320 px in both
  themes, wrote "the 320px previews confirm 'Save changes' and 'Delete project' are clipped", fixed it, and looked
  again at 320 and 1440. A third Claude turn on the starter view's invite screen looked, changed it, then looked at
  three screens, and its reply raised what it saw: the member table runs off the right edge on a phone. It also
  said the tool cannot photograph a state reached by clicking (an error after Send). Two images take about 0.75 s
  with the browser warm. Found on the way: Codex reads the user's own `~/.codex/skills/` during a design turn
  (noted under Known limits in DEVELOPMENT.md), and the browser keeper's timing test failed on one CI runner, so
  its margins are wider now.

- 2026-10-18: Capture any specimen. `capture.html?specimen=<id>&theme=` renders a specimen's blocks with the
  gallery's own block components and the spacing of a gallery section, without the header or the Refine button,
  padded by `space-8` (`space-4` under 720px) so shadows and focus rings are not cut off; it fills the width the
  browser gives it rather than the gallery's 1080px column. Views are specimens too, so a view id works there and
  shows its flow with the screen strip, as in the gallery; `{ view, screen }` gives the bare screen as the kit
  does. `server/screenshots.ts` reuses the kit's page, browser launch, flags and context (the shot-taking moved
  out of `captureViews` into `takeShot`, so both use the same code); `NEUTRAL_CSS` is not added, since the capture
  page's own stylesheet already has those rules. A specimen's default shots are those of a flow without `capture`
  (375, 768 and 1440, full page, light) and a view screen's are what its flow asks for; the screenshot tool can
  pass its own. Every call reads the page's list first, so an unknown id fails with the ids there are instead of
  a picture of an error. One browser context stays open with the browser, so the preview's modules stay cached:
  four shots took about 1.3 s with the browser warm. A page that does not settle in 30 s (a compile error in the
  preview) is reported as such. Each open project has its own instance, closed with the project; nothing calls it
  yet. Against a throwaway instance a script captured `buttons`, `navbar` and the starter view's member screen at
  375 and 1280 in both themes, all rendered correctly, a capture repeated gave the identical image, the browser
  closed after the idle time, and the verification kit still built (9 stable shots) after the refactor.

- 2026-10-18: Round 2 planned. Order follows Lucas' priorities: the agent's own work first (it sees what it built,
  then more checks), then what the service can do, then packaging. Specimen capture comes first because the
  screenshot tool, the stability check and version comparison all build on it. The template move is its own step
  with no behaviour change, so the picker and external templates land on a settled structure. Evals come after the
  headless commands, which they can reuse. The Tailwind template is last of the build steps because it is the
  largest and nothing else depends on it.

- 2026-10-18: The verification kit. A design should be a guardrail during feature work, not only a picture: the
  agent implementing a feature proves its pages match the view's screens pixel for pixel, with 0% as the target
  and every allowed difference a named exception with a reason. Screens are captured at fixed widths with a
  viewport height per width (content sized in vh needs the same one on both sides), full page by default, and
  each twice, since a screen that renders differently twice can never match. The kit carries a runnable copy of
  the design rather than only images, because screenshots from another operating system differ in antialiasing:
  the implementing agent captures both sides on its own machine. Views should use the product's real data from
  the linked repo where possible, so no separate test data is needed. Lucas will try it at work; widths and the
  acceptable deviation are adjustable afterwards. The template version stays at 1: the new `capture` option is in
  `specimen.ts`, which agents do not edit, so untouched workspaces get it on start and no guided turn is needed.
  A build of the capture page and a capture against the dev preview gave identical images.

- 2026-10-18: Folders without typing paths. Linking a repo meant typing its full path. Basis runs on the same
  computer as the browser, so the server opens the system's own folder dialog, and suggests the git repos it finds
  in the usual code folders; pasting still works. Over HTTP rather than the bridge, since these are questions the
  dialog waits for, limited to POSTs from Basis' own origin. On Windows, PowerShell 7 gives the modern dialog but
  takes about three seconds to start; the button says to choose in the dialog meanwhile. The dialog's checkbox was
  the size of a button: the dialog's text-field rule applied to every input.

- 2026-10-18: Basis runs the user's own Claude Code instead of shipping one. The Claude adapter's SDK lists a
  native Claude Code binary per platform as optional dependencies, and npm installs those for any package that
  depends on the adapter: about 260 MB of the install. The adapter now comes through npx with `--omit=optional`
  (62 MB, once) and is pointed at the user's executable, which they already have since they log in with
  `claude`. A real turn ran on Claude Code 2.1.296 against an SDK built for 2.1.300; much older versions are
  untested, so an agent that exits says to run `claude update`. It also fits Anthropic's terms better: the user
  runs their own, unmodified Claude Code.

- 2026-10-18: Template updates for existing workspaces. A workspace owns its copy of the starter template, so
  Basis replaces only what nobody changed: files matching an earlier version from git history
  (`template/history.json`), a component's files together, since a new Navbar.tsx needs its new stylesheet
  (found by a real run, where the source was updated and the changed stylesheet was not). Changed files get a
  guided turn from `template/CHANGES.md`; against an older Navbar with its own bar height, the agent brought in
  the three layouts, kept the height and opened a review. It first reached for `diff` in a shell, which waits for
  approval, so the instruction says to compare with the read tool. This replaces `EARLIER_SPECIMEN_FORMATS`,
  whose three hashes the history reproduces exactly.

- 2026-10-18: Packaging. The name stays Basis (no design tool by that name turned up), published on npm as
  `basis-design`, since `basis` is taken; the command is still `basis`. Apache-2.0 for the app, for its patent
  grant and because the ACP adapters use it; MIT-0 for `template/`, because those components are copied into the
  products people build and should carry no conditions. npm first rather than a desktop app: the people who have
  Claude Code or Codex already work in a terminal, and an app needs signing, updates and a bundled Node. Projects
  live in `~/.basis`, since an npx cache or an update replaces Basis' own folder.

- 2026-10-18: Release readiness. Anthropic's terms allow a product to run the unmodified Claude Code with the
  user's own login, so Basis keeps subscription sign-in; the picker says "Claude", as the branding rules ask. The
  design agent no longer inherits the user's Claude Code setup: `settingSources: []` rather than `["project"]`,
  because the project source reads CLAUDE.md in every folder above the workspace and so picked up
  `~/.claude/CLAUDE.md`; the brief already arrives as the system prompt. The adapter takes its starting permission
  mode from the user's settings regardless, so Basis switches the session to the mode that asks. Codex had never
  run: the old adapter failed on today's models, and in its default mode Codex edited files without asking Basis,
  so it now runs on `@agentclientprotocol/codex-acp` in read-only mode, where edits come to Basis for approval.
  Narrow Navbar and AppShell use container queries, so they respond wherever they sit, not only in the gallery's
  frames; the sidebar's rail is tied to a narrow AppShell so a sidebar on its own keeps its width. Spinners keep
  turning under reduced motion, since they are the only sign that work goes on.

- 2026-10-18: Design guidelines for the agent. Researched from primary sources (WCAG 2.2 and its Understanding
  documents, the APG patterns, Material 3 tokens, Apple HIG, GOV.UK, Carbon, Atlassian, Polaris, Spectrum, NN/g,
  Laws of UX, HAX, PAIR, and visual-craft writers) and distilled in our own words into `server/guidelines.md`:
  per component family, screens and flows, writing, AI assistants, colour, dark mode, depth, type, spacing, motion
  and a "Before you reply" checklist. It is a separate file read per section rather than part of the brief, which
  only keeps the rules that always apply, so the agent's standing context stays small. Known gaps between the
  guidelines and the starter template (reduced motion outside Chat, field errors not tied to inputs with
  aria-describedby) are left for a template pass.

- 2026-10-18: Both themes on every change. Redesigning buttons showed the agent tuning sheens and shadows for one
  theme: shadow and component tokens have one value for both, and the defaults were fixed colours. Now a `shadow`
  role carries each theme's shadow colour and strength, the defaults mix it, the brief has a both-themes section,
  fixed colours outside the roles are findings, and axe also runs in the theme the user is not looking at, in a
  hidden copy of the preview (it renders the gallery a second time; watch for that on large galleries).

- 2026-10-18: Contrast runs in the preview on browser-resolved colours rather than on the server, so oklch,
  color-mix and var() references work. Findings travel as their own `checks` channel, do not block Approve,
  and reach the agent only when its turn introduced them (once; a fix-up turn starts from them). Borders are
  not checked, since most systems draw them below 3:1 on purpose; `textSubtle` is held to 3:1.
- 2026-10-18: Views in reviews: `rows` picks a flow's screens by label or id, and the panes of one review target
  share the flow position, so side by side, blink and alternatives compare the same screen. Every step of this
  roadmap is done.
- 2026-10-18: New view is a guided turn (`viewInstruction`); the description may be a whole ticket (8,000
  characters). From the HAR-212 ticket against the Harbor project the agent built five screens (delayed list,
  shipment, notify customer, nothing delayed, load error) from existing components and patterns, with consistent
  made-up data, opened a review and recorded its assumptions in product.md. Fixed on the way: grep names its path
  only in its input, so auto-approval now falls back to input paths; the rebase plugin missed React fast
  refresh's self-import by absolute path, which broke the before side of any specimen with top-level components
  (views have them); the brief now tells the agent to edit with its tools, since it tried `sed` once.
- 2026-10-18: Views reuse the specimen format with a new `flow` block (screens with `go(screen, data)`), so the
  glob, reviews, widths and the accessibility check work for them unchanged. `views/` is a third page and source
  folder (agent-editable, type-checked, seeded into older workspaces), left out of the starter kit. The starter
  view is a team-members flow (list, member, invite). The specimen template changed again, so the previous
  version's hash went into `EARLIER_SPECIMEN_FORMATS`, and the migration note now reads "the newest specimen
  format". The sidebar offers no New view yet (next step).
- 2026-10-18: Repo context: each turn names the repo and points at product.md when it exists (or asks the agent
  to start it); the brief's "A linked product repo" section covers read-only use, keeping product.md current,
  demo content in the product's language and following the repo's structure for existing features. In a fresh
  session the agent read product.md first and filled stat cards with Harbor's shipment terms without opening the
  repo.
- 2026-10-18: Creating a project from a repo checks the folder before anything is created, names the project
  after the repo folder when no name is given, and starts the bring-in turn once the new project's agent is
  ready (`AgentHost.whenReady`).
- 2026-10-18: Bringing in a design system is one guided turn (`importInstruction` in `server/brief.ts`),
  offered by a checkbox when linking and from the project menu. `product.md` is a new agent-editable file in
  history. Against the Harbor fixture the agent mapped every token, matched fonts, radii and density, restyled
  badges as Harbor's status pills, wrote a component inventory and opened a review; the fix loop then caught
  dark-theme contrast it had introduced and it fixed part of it. Findings that survive the one fix-up turn stay
  listed for the user rather than being sent again.
- 2026-10-18: A linked repo is stored on the project entry (`repo`). Reads and searches inside it are approved
  automatically; shell commands there still ask, and the per-turn context steers the agent to its read and
  search tools. Incident while testing this step: an instance started with a fresh `BASIS_HOME` adopted
  `workspace/` in the repo (Lucas' real workspace) as its fallback and committed the pattern-contracts
  migration there, the same entry Lucas' own next start would have made; nothing was lost. A custom home now
  starts with a new project instead. Also fixed: the project dialog waited forever when the same error came back
  twice.
- 2026-10-18: Pattern contracts copy the starter patterns' props, minus gallery-only ones (`force`,
  `forceHover`) and layout switches a product would not rely on. Removing an optional prop still passes (the
  check is structural); changing a prop's type or adding a required one fails. Icon names make the contracts
  generic (`PatternContracts<IconName>`), and `DataTable` stays generic over its rows. Older workspaces get
  `patterns/contracts.ts` seeded on start.
- 2026-10-18: axe runs in the preview over marked live demos only. Duplicate-id rules are off (the gallery
  repeats demos on purpose), and only serious and critical violations count. The starter template had three
  findings, now fixed: the loading button hid its label from screen readers, Progress had no accessible name
  (new optional `label` prop, also in the contract), and the gallery's scroll areas were not keyboard
  reachable.
- 2026-10-18: Order is quality checks first (small, and every later step benefits from them), then repos,
  then views (views read best once a project looks like the product).
