# Developing Basis

README.md describes the product. This file is for whoever works on Basis itself, people and coding agents alike:
how it is put together, how to run and check it, the gotchas that cost time, and where the work stands. Keep it
current when something here changes.

It is not called CLAUDE.md or AGENTS.md on purpose: the workspace sits inside the repo, and the design agent
would inherit a repo-level instruction file.

## What Basis is

A local web app for prompting a complete design system into existence. On the left, a chat with Claude Code or
Codex over the Agent Client Protocol (ACP), using the user's own CLI login and subscription with no API keys. On
the right, a live gallery of the design system. The agent owns everything in the workspace: tokens, base
component source, patterns and the gallery specimens.

## Architecture

- `server/index.ts`: the chrome server, the bridge, and switching between projects.
  - **Chrome** on `PORT` (5320) serves `index.html` and is the only origin allowed on the `/bridge` WebSocket.
  - `server/projects.ts` keeps the project list (`<BASIS_HOME>/basis.projects.json`); `server/project.ts` is the
    open project: its workspace, its agent and its **preview** server. Switching closes one `OpenProject` and opens
    the next; the bridge sends a fresh `hello`, and the chrome remounts its `Workbench` for the new project. A
    project entry may name a product `repo`; linking one updates the open project in place (`OpenProject.update`),
    and `AgentHost` auto-approves reads and searches inside it and tells the agent about it every turn. Bringing in
    its design system is a guided turn (`importInstruction`), and what the agent learns goes to `product.md` in
    the workspace, which it may write like the design file.
  - **Preview** on `PORT + 1` (5321) serves `preview.html` in a sandboxed iframe. Aliases: `@ds`
    (components/index.ts) and `@workspace` (the workspace folder, for the specimen glob). `server/rebase.ts` is a
    Vite plugin that serves today's specimen file inside a snapshot copy (see Reviews).
- `server/agent.ts`: the ACP client (`@agentclientprotocol/sdk`).
  - It spawns `claude-agent-acp`, or `codex-acp` via npx, and strips inherited `CLAUDE_*` and
    `ANTHROPIC_BASE_URL` variables when launched from inside a Claude Code session (the agent's OAuth refresh
    fails otherwise).
  - It auto-approves reads inside the workspace and edits to the files the agent may change.
  - After each turn it gathers problems (token validation, `tsc` against the contracts, review.json problems,
    render errors reported by the preview) and sends them back to the agent, at most twice. Every open tab
    reports its preview's errors with its visibility; `server/previews.ts` picks the tab the user looks at (or
    looked at last), so a stale or second tab cannot send the agent after problems that are not there.
  - Prompts sent while a turn runs are queued. The conversation is saved to `.basis/chat.json`
    (`server/chatlog.ts`) and the agent session is resumed after a restart where the agent supports
    `session/resume` (Claude Code does).
- The workspace, one module per concern, coordinated by `server/workspace.ts` (serial git queue, file watcher,
  events):
  - `setup.ts`: seeding from `template/`, migrations of older workspaces, generated files (`AGENTS.md`,
    `CLAUDE.md`, `tsconfig.json`, `.basis/`).
  - `history.ts`: one commit per agent turn, approved review, restore or hand edit, with `Basis-*` trailers.
  - `reviews.ts`: the open review (see below).
  - `snapshots.ts`: read-only copies of past versions in `.basis/snapshots/<commit>/`.
  - `paths.ts`, `exec.ts`: shared paths, git and tsc helpers.
- `server/brief.ts`: the agent's instructions, also sent as an appended system prompt.
- `server/export.ts`: the starter kit, as a zip from `GET /export/starter-kit.zip` or written into a folder.
- `shared/`: `design.ts` (zod schema and defaults for `design-system.json`), `tokens.ts` (CSS variables and
  exports), `protocol.ts` (bridge messages), `frame.ts` (chrome-iframe messages, pages, and the parser for
  untrusted preview input), `review.ts` (review.json format), `contracts.ts`, `annotations.ts`, `diff.ts`.
- `src/` (chrome): `App.tsx` keeps the bridge and mounts `Workbench.tsx` once per project, which wires the
  parts; `shell/` holds the top bar and project menu, sidebar, history, inspect and review bars, dialogs,
  `PreviewFrame`, `useReview` and `prefs`; `chat/` holds the panel and composer.
- `src/preview/` (iframe): `main.tsx` (messaging, picker, scroll spy, errors, link guard), `Preview.tsx`
  (foundations and specimen sections, or the review), `specimens.tsx` (glob and validation of
  `*.specimen.tsx`), `narrow.ts` (resolving review targets), `Review.tsx`, `Impact.tsx` ("also changed"),
  `progressive.ts` (rendering large pages in steps).
- `template/components` and `template/patterns`: starter source with specimens; `template/contract-check.ts`
  proves the template satisfies the contracts, for components (`shared/contracts.ts`) and patterns
  (`shared/pattern-contracts.ts`, generic over the workspace's `IconName`, since icon names are the
  workspace's own and a contract may only import from react).

### Chrome and preview

The chrome sends the preview one `PreviewView` (`shared/frame.ts`: design, theme, page, review) whenever any of
it changes, and receives every preview message through one `onMessage` handler in `App.tsx`. A new preview
feature adds a field to `PreviewView` or a message to `FromPreview` (with its parser case), not a prop at every
layer.

### Reviews

The agent opens a review by writing `review.json` (title and up to four targets: specimen, block, rows,
columns). While it is open, every turn and hand edit is recorded as an iteration on `refs/basis/review` instead
of history; Approve makes one history entry, Discard restores the starting commit. The preview shows each target
before and after: the before side imports the snapshot copy of the starting point, or today's specimen on the
starting point's components when the block is new. `Impact.tsx` renders the other sections before and after
offscreen and compares structure and computed styles for "Also changed", but only the sections the review can
reach: `server/reach.ts` follows changed files and changed CSS variables (with the tokens that refer to them)
through the workspace's imports, by name through barrels, and stores the result on each iteration as `reach`.
A change to a variable every component inherits from the gallery root (font, text colour, background, size,
leading) reaches everything.

A target can ask for `widths`; the preview then renders each block in frames (`Framed` in `specimens.tsx`),
which are size containers. The gallery's Show at bar uses the same frames, and can also show both themes; a
review shows one theme at a time (Lucas prefers toggling), which starts from the system theme. Blink
stacks the panes in one grid cell and hides all but one; the chrome forwards the B key to the preview, so it
works wherever focus is.

**Alternatives** (×2 or ×3 by Send): `AgentHost.runAlternatives` runs one checked turn (turn plus fix-ups) per
take. Between takes `Workspace.nextAlternative` restores the starting commit with `asBase`, so going back is not
an iteration and the next take's commit has the start as parent. `alternativeDone` records each take's last
iteration in `ReviewState.alternatives`; the first take must open the review, or the set ends with a notice.
The workspace keeps the last take, which the preview renders live (so the fix loop still sees render errors);
the others render from snapshots like the before side. `chooseAlternative` restores the chosen take as a new
iteration (none if it is the one on show). A new iteration after the set puts it away; approve waits until one
is chosen. The queue waits for the whole set.

### Checks

Automatic checks report findings, not failures: the preview sends them as a `checks` message next to its
render `errors`, the chrome lists them apart and forwards them with `preview-errors`, and `AgentHost` puts
only the findings a turn introduced (not there when the turn started) into the fix loop. Contrast
(`shared/contrast.ts`) checks role pairs on colours the browser resolved, so any CSS colour works; the gallery's
contrast table uses the same pairs. Text is held to 4.5:1, `textSubtle`, `primary` on `bg` and the focus ring to
3:1; disabled text and borders are not checked.

Accessibility (`src/preview/a11y.ts`) runs axe-core over elements marked `data-checked` (each specimen's
demos and the review's live panes, never past versions, foundations or the offscreen impact copies), 600 ms
after anything that changes them, and keeps serious and critical WCAG A/AA violations, one per demo and rule so
the text stays stable for the comparison. Duplicate-id rules are off, since the gallery repeats demos. While a
check is scheduled or running the preview says so, and the fix loop waits for it (up to 8 s after the usual
settle time) before it decides what the turn introduced.

### Large galleries

A page renders its first six sections at once and the rest six per task (`src/preview/progressive.ts`), with a
placeholder of roughly a section's height for each one still waiting. Nothing is unmounted, so every section
still reports render errors to the fix loop. A hidden tab renders everything in one go, and scrolling to a
section renders everything above it first. Measured with 86 component sections (2,356 components): the first
commit went from about 440 ms of blocking render to about 65 ms, with the rest done within three seconds.

## Run and check

```bash
npm run dev          # http://localhost:5320; server changes need a restart, client code hot-reloads
npm run check        # everything below, as CI would
npm run typecheck    # tsc 7 over src, server, shared, template, test
npm run lint         # oxlint: correctness, React hooks, unused code
npm run format       # prettier --write .
npm test             # node:test via tsx: pure functions plus workspace git flows in temp folders
```

- **Tests** live in `test/`. `workspace.test.ts` runs real git in throwaway folders and stubs the type check
  (`new Workspace(dir, { typecheck })`). Add a test with every change to history, reviews or migrations: that
  code restores and deletes files in the user's workspace.
- **Before restarting the dev server**, check that the agent is idle: a turn in flight is lost. A small Node
  script connecting to `ws://127.0.0.1:5320/bridge` with header `origin: http://localhost:5320` gets a `hello`
  message containing `agent.status`. The chat and an open review survive the restart.
- **To kill the server on Windows:** `Get-NetTCPConnection -LocalPort 5320,5321 -State Listen | % { taskkill /PID $_.OwningProcess /T /F }`.
- **Test changes that touch the agent or the workspace** in a separate instance with a throwaway workspace:
  `PORT=5330 BASIS_WORKSPACE="$TEMP/basis-test-ws" npx tsx server/index.ts`. `BASIS_WORKSPACE` opens just that
  workspace and never touches the saved project list. To test projects themselves, give the instance its own
  home instead: `PORT=5330 BASIS_HOME="$TEMP/basis-test-home" npx tsx server/index.ts`. A home of its own starts
  with a new project in its `workspaces/` folder; before 2026-10-18 it adopted `workspace/` in the repo, which is
  Lucas' real workspace. Stop it and delete the folder afterwards.
- **Verify in the built-in browser.** The parent cannot read the iframe's DOM (by design), so check preview
  content with screenshots and zoom, or through what the chrome shows (sidebar, problems list, chips).
- **Verify the export** by unzipping the kit into a temp app with a `tsconfig` whose `paths` point at Basis'
  `@types/react` and a Vite config aliasing react, then running tsc and vite build.

## Gotchas

- **TypeScript 7 has no JavaScript API**, so typescript-eslint cannot run; linting is oxlint, which honours the
  existing `eslint-disable` comments.
- **Backslashes in generated code:** the Bash tool mangles them inside heredocs and Python `-c` strings, so
  `"\n"` turned into a real newline several times. Use the Edit/Write tools for code containing backslashes.
- **CRLF:** files in the Windows checkout are CRLF (`core.autocrlf=true`); seeding normalises templates to LF,
  and Prettier runs with `endOfLine: auto`.
- **Workspace git:** it runs as user "Basis" with `core.autocrlf=false` (see `server/exec.ts`).
- **OAuth refresh races:** several Claude Code processes at once (a dev instance, a test instance, a Claude Code
  session) can make a turn fail with "another Claude Code process is refreshing it". It is transient; retry.
- **Hidden tabs:** rAF does not run in background browser tabs, so do not gate chrome-iframe messaging on rAF.
- **StrictMode:** it remounts class components in dev. `SectionBoundary` reports from mount and update so
  problems survive that.
- **Fast Refresh** does not retry failed error boundaries on its own; sections reset on `vite:afterUpdate`. A
  module that exports anything but components (Review.tsx once exported a helper) reloads the whole preview.
- **Specimen glob keys** keep the alias form only while the workspace is inside the repo; outside it, Vite
  turns them into relative paths. The page comes from the second-to-last path segment (the folder), matched
  against `PAGES` in `shared/frame.ts`, the single list of pages and source folders.
- **Vite ids are forward-slash paths**, also on Windows. Compare against `normalizePath(...)` in plugins.
- **Radio groups are per document:** two copies of a specimen with named radios uncheck each other. The review's
  before side and the offscreen impact copy are each wrapped in a `<form>`; FormSection then nests a form, which
  only logs a React warning in the iframe console.
- **Impact fingerprints** skip ids and normalise `url(#...)` in computed styles, since `useId` values differ
  between copies.
- **Smooth scrolling gets cancelled** by the layout changes of progressive rendering, so scrolling to a section
  jumps while sections are still being added and is smooth once the page is complete.
- **Specimen format upgrades:** `components/specimen.ts` lives in each workspace. Seeding replaces it only when
  its LF-normalised sha256 matches a known earlier template (`EARLIER_SPECIMEN_FORMATS` in `server/setup.ts`).
  When you change `template/components/specimen.ts`, add the hash of the version you replace to that list.
- **Vite remembers removed files:** a snapshot copy deleted and written again at the same path while the
  preview server runs gives 404s. Copies are therefore only pruned at start-up, and the chrome forgets its
  cached past versions when a review ends or the server says hello again.
- **`.ds-root` fills the viewport** (`min-height: 100vh`) as the page root; review panes and width frames, which
  are `.ds-root` too, reset it.
- **Section ids** must stay under 80 characters: the chrome truncates longer ones from the preview. Repeated ids
  become `id-2`, `id-3` (they used to grow as `id-2-2-2`, which broke navigation with many duplicates).

## Working agreement with Lucas

- Reply in Swedish. Code, commit messages and docs are in English. No AI attribution or Co-Authored-By.
- Commit and push only when asked; Lucas usually says "committa och pusha". Commit messages explain why, with a
  body listing the main changes.
- Ask before deleting the user's data. For bigger features, sketch the user flow (what starts it, the loop, what
  ends it) and get a yes before building, then build, verify in the browser, and report what was tested.

## Where things stand

Lucas is rolling out a larger idea in steps:

1. Multiple pages with a Patterns page: done.
2. Adding components and patterns (sidebar buttons, guided turn, `components/contracts.ts`): done.
3. Reviews, replacing a manual "Compare" view Lucas rejected: done.
4. Groundwork: tests, oxlint and Prettier, the workspace split into modules, one preview view model, App split
   into hooks, the chat and agent session surviving restarts: done.
5. Tokens for added components: `components` takes a group per added component next to the strict baseline
   groups; `shared/design.ts` checks the names and that no two tokens share a CSS variable: done.
6. Projects: a project menu to switch, create (blank or a copy) and open workspace folders; one project open at
   a time, each with its own agent session: done. This is the base for linking Basis to real projects (reading
   a product repo's context, designing views for one of its features).
7. Scaling the preview: pages render progressively, and "also changed" checks only the sections a review can
   reach: done. Specimen modules still load up front; at 230 ms for 86 sections that was not the bottleneck.
8. Comparing better: blink mode in reviews; pattern states (the `states` block) plus widths and both themes
   through container frames; several alternatives side by side, picked with ×2/×3 by Send: done.

The next step is Lucas' call.

Ideas discussed for later: contracts for patterns, automatic accessibility checks (axe) in the problems loop,
making the starter patterns respond to narrow widths (the Navbar overflows at mobile width today).

## Known limits

- **Inspecting a past version** (history menu) shows that version's tokens with today's component code. The
  banner says so, and Restore brings back both. Reviews run a past version's real code from
  `.basis/snapshots/`, and inspect could reuse that.
- **Impact noise:** a specimen whose demo changes on its own (timers, random data) would always show under
  "Also changed". None of the starter specimens do.
- **Reach is static.** A specimen that reads token values from its `design` prop in JavaScript, rather than
  through CSS variables, is not found by `reach.ts`; its section is then left out of "Also changed".
- **Undo** sits on Basis' own migration entries ("Basis added starter patterns") right after an upgrade, so
  pressing it removes the seeded files. They can be restored from history.
- **Patterns have no contracts.** Base components added by the agent get one in `components/contracts.ts`,
  but `patterns/` exports are only type-checked.
- **Codex** is wired up but has never been tested.
- **The export dialog** closed by itself once during testing, and it could not be reproduced.
- **Pattern links** default to `href="#"` when no `href` or `onNavigate` is given. The preview's link guard
  makes that harmless in the gallery.
