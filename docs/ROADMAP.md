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
(fonts across machines, real photos). Decide after trying the kit on a real feature at work.

## Round 2 steps

### From Lucas' testing

- [ ] **Reading the product repo without prompts.** Claude Code is only given the workspace as `cwd`
      (`openSession` in `server/agent.ts`), so its shell commands in the linked repo (`cd … && git ls-files`, `ls`,
      `find`, `grep`) and searches without a path always ask. Pass the linked repo as `additionalDirectories`, and
      rebuild the session when the link changes. A project whose folder sits inside a git repo links that repo by
      itself (read only, as a linked repo). On Windows the folder dialog is the old tree picker; use the modern one
      (`IFileOpenDialog` with `FOS_PICKFOLDERS`) in both Windows PowerShell and pwsh. Done when: a real Claude turn
      in a project inside a fixture repo reads the repo with shell commands and searches without a prompt, and
      writes there are still refused.
- [ ] **The preview waits for the turn.** Mid-turn states (a half-written file, an import of a file not written
      yet) leave errors that outlive the turn: the preview never reports an empty list after a reload, so the old
      list stays in the chrome and the server; a new specimen whose first load failed stops taking HMR updates; and
      the fix loop reads the report after a fixed 1500 ms. Hold the preview's code updates while a turn runs (a
      plugin in the preview's Vite), reload the gallery once when it ends, have the preview report its errors on
      `ready` and the chrome reset them, and let the fix loop wait for a report from after the reload. The agent's
      screenshots keep showing its work mid-turn. Done when: a real turn that creates a new view in several writes
      ends without stale errors, and the gallery shows the view without a manual reload.
- [ ] **Images in the kit.** Exceptions can name elements by `selector` (the kit works out their boxes per shot on
      both sides and still checks the boxes' size), views use local placeholder images marked `data-basis-media`
      (the brief says so), and a check reports remote image URLs in views. Done when: a view with a photo passes
      the kit with a selector exception, and a remote image is reported.
- [ ] **A prompt for the implementing agent.** Merges "Implementation notes in the kit" and "A skill for the
      implementing agent" below: the kit carries `PROMPT.md` (goal, each view's screens, flow, components and
      tokens, the capture and compare loop, the exception rules, when to stop) and the Export tab gets "Copy prompt",
      which tells the agent to read it. Done when: an agent given only the copied prompt in a fixture repo finds the
      kit and runs the loop.
- [ ] **Several projects at once.** Projects stay open while their agent works after you switch away; the project
      menu shows which are busy, done or waiting for an approval. Each open project gets its own preview port, the
      screenshot tool names its project, and server messages carry the project. A project in the background gets
      its preview checks from a headless page. Idle projects close after a while. Done when: two projects run turns
      at the same time and each ends with its own history entry and no crossed messages.
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

- [ ] **Implementation notes in the kit.** For each view the kit gains `views/<view>.md`: its screens (id, label,
      the shots), the flow (which screen's `go()` leads where, from literal calls in the source), the components and
      patterns it imports from the workspace, and the tokens in `design/design.json` it can use. Decision: written
      from the source without an agent turn, so the notes always match the screenshots. The README and the manifest
      point at them. Done when: tests cover the source reading, and the kit built from the starter view has notes
      that are correct.
- [ ] **A skill for the implementing agent.** The kit carries `SKILL.md` (Claude Code's skill format) with the
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
