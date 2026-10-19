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

- `server/index.ts`: the chrome server, the bridge, and the projects open at once.
  - **Chrome** on `PORT` (5320) serves `index.html` and is the only origin allowed on the `/bridge` WebSocket.
    Both servers answer only requests whose `Host` is `localhost` or `127.0.0.1` with their port
    (`isLocalHost` in `server/project.ts`), so a page that rebinds its own name to 127.0.0.1 gets a 403.
  - `BASIS_HOME` defaults to `~/.basis`, never Basis' own folder, which an update or the npx cache may replace.
    Earlier versions kept the list in the repo root; `Projects.load({ legacyList })` reads it once when the home
    has none and saves it there (the old file stays, and its projects keep their absolute paths).
  - `server/projects.ts` keeps the project list (`<BASIS_HOME>/basis.projects.json`); `server/project.ts` is an
    open project: its workspace, its agent and its **preview** server. Several are open at once
    (`server/open-projects.ts`, `OpenProjects`): each tab shows one, and switching shows another in that tab
    (opening it unless it is open) while the one it left goes on, its agent included; the bridge sends that tab a
    fresh `hello`, and the chrome remounts its `Workbench` for the new project. A project's messages go only to the
    tabs that show it, tagged with its id (`projectId`, `Tagged` in `shared/protocol.ts`), and the chrome drops a
    tagged message of another project; what the chrome sends is tagged by `App` with the project of the workbench
    that sent it, so a message sent while the next project opens still reaches the one it was meant for (an
    untagged message goes to the project the tab shows). A tab that reconnects names its project in the bridge URL
    (`/bridge?project=<id>`). `OpenProjects` also keeps each project's status for the project menu (`working`,
    `waiting` for an answer to a permission request, `done` for a turn that ended while no tab showed it, sent to
    every tab as `project-status`), and closes a project no tab shows once its agent has been idle for
    `IDLE_CLOSE_MS` (ten minutes). Each open project holds a slot, the lowest free number: slot 0 gets the preview
    port below, the others a free port from the system (ports in a row could run into another Basis), and each slot
    its own Vite cache (`node_modules/.vite/preview-<slot>`), since Vite servers sharing one race to write the
    deps they optimise. The project shown last is `active` in the list and opens at start. A project entry may name
    a product `repo`; linking one updates the open project in place (`OpenProject.update`),
    and `AgentHost` auto-approves reads and searches inside it, refuses edits there without asking, and tells the
    agent about it every turn. Claude Code gets the repo as a working directory (`sessionMeta`, through
    `_meta.claudeCode.options.additionalDirectories`; ACP's own `additionalDirectories` would make it writable for
    Codex), so its read-only shell commands there (`ls`, `find`, `grep`) run without asking; a changed link reaches
    the session before the next turn (`syncRepo`: `session/resume` with other directories makes the adapter rebuild
    the session from its transcript, so the conversation goes on). Opening a folder that lies inside a git repo
    links that repo (`enclosingRepo` in `server/projects.ts`, looked for above the folder and below the home
    folder), once, when the folder is added; existing entries are left alone. Bringing in its design system is a
    guided turn (`importInstruction`), and what the agent learns goes to `product.md` in the workspace, which it
    may write like the design file. Each turn points the agent at `product.md` when it
    exists (`repoContext` in `server/agent.ts`), so it reads that before the repo.
  - **Preview** on `PORT + 1` (5321) for the first open project, a free port for each other one, serves
    `preview.html` in a sandboxed iframe; the `hello` tells the chrome its port. Aliases: `@ds`
    (components/index.ts) and `@workspace` (the workspace folder, for the specimen glob). `server/rebase.ts` is a
    Vite plugin that serves today's specimen file inside a snapshot copy (see Reviews).
  - `server/hold.ts` holds the preview while an agent turn runs (`PreviewHold`, one per open project, held from the
    start to the end of each `runTurn`, fix-ups included). Its Vite plugin's `hotUpdate` hook (order `post`, after
    the specimen glob adds its importer for a new file) returns no modules, after invalidating them as Vite's own
    update would, so a page loaded fresh (the agent's screenshots, the stability check) still sees the files as they
    are; the workspace's `design` and `review` messages to the chrome wait too, the latest of each. The chrome shows
    "Changes show when the agent is done" while something waits (`preview-waiting`). When the turn ends,
    `basis:release` (Vite's HMR channel) makes only the gallery (`preview.html`, not its copy in the other theme and
    never `capture.html`) reload once, back to where it was scrolled (`reloadInPlace` in `src/preview/main.tsx`).
    Each such reload is a new generation, served to every gallery document in a `basis-preview` meta tag
    (`shared/hold.ts`); the gallery sends it with `ready`, and the chrome with every `preview-errors` report.
- `server/agent.ts`: the ACP client (`@agentclientprotocol/sdk`).
  - It starts `claude-agent-acp` or `codex-acp` through npx at pinned versions (`CLAUDE_ACP`, `CODEX_ACP`), with
    `--prefer-offline` so a fetched adapter also starts offline. Claude's adapter is fetched with
    `--omit=optional`, which leaves out the copy of Claude Code (about 260 MB) its SDK would bring, and runs the
    user's own: `findClaude` (`server/claude.ts`) passes it as `CLAUDE_CODE_EXECUTABLE`, from that variable, the
    PATH (on Windows the executable behind npm's `claude.cmd` shim, which cannot start without a shell) or the
    native installer's folder. Without it the agent does not start and says how to install it.
  - It strips inherited `CLAUDE_*` and `ANTHROPIC_BASE_URL` variables when launched from inside a Claude Code
    session (the agent's OAuth refresh fails otherwise).
  - It auto-approves reads inside the workspace and edits to the files the agent may change. Paths are compared
    where they really are (`relativeInside` in `server/paths.ts` follows symlinks and junctions, also for files
    not written yet), so a link out of the workspace or the repo is not approved.
  - Each session starts with `SESSION_META`: Claude Code loads none of the user's settings (`settingSources: []`,
    since the project source also reads `~/.claude/CLAUDE.md` for a workspace under the home folder), no claude.ai
    connectors, no bypass mode, and auto memory is off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`). The brief arrives as
    the appended system prompt. The adapter still takes the initial permission mode from the user's
    `~/.claude/settings.json`, so `askingMode` switches the session to `ASKING_MODES` (Claude `default`, Codex
    `read-only`) after `session/new` and `session/resume`. Codex's other modes edit the workspace unasked.
  - The Codex adapter is `@agentclientprotocol/codex-acp` at a pinned version (`CODEX_ACP`); the old
    `@zed-industries/codex-acp` stopped in June 2026 and fails on newer models.
  - Codex loads none of the user's setup either (`codexEnv` in `server/codex.ts`). It runs with `CODEX_HOME` set to
    `<BASIS_HOME>/codex`, since nothing else keeps Codex from reading `~/.codex/AGENTS.md`, and that home also
    leaves out the user's config (model, sandbox and approval choices, developer instructions, MCP servers,
    plugins, notify), skills, hooks, rules and memories. Its `auth.json` is a link to the user's, renewed at every
    start: a symlink, or on Windows without developer mode a hard link, which stays the same file because Codex
    rewrites `auth.json` in place, so a refreshed token reaches both homes. `CODEX_CONFIG` (`CODEX_SETTINGS`,
    merged by the adapter into every session) turns off what comes from outside the home or with the login: the
    skills catalog (`skills.include_instructions`, which also covers `~/.agents/skills`), the bundled skills, apps,
    plugins, memories and hooks. Without a login file to link (not logged in, or a login kept in the keyring) Codex
    runs in the user's own home with only those settings, and Basis says so on the console. No Windows sandbox is
    configured in Basis' home, so on Windows Codex asks before every command: the elevated sandbox is set up per
    home with an administrator prompt, and the unelevated one cannot start PowerShell installed from the Store.
  - Basis approves Codex's commands that only read (`isCodexRead` in `server/agent.ts`), as Claude Code's reads are.
    Codex reports every command as `execute`, but its approval request carries the command line (the shell and
    script, POSIX-quoted, `"…\pwsh.exe" -Command 'Get-Content a.ts'`) and its folder. `server/commands.ts` reads
    PowerShell and POSIX scripts in a strict subset: plain words and quotes, `;`, `|`, `&&`, `||` and dropping
    errors (`2>$null`, `2>&1`); listed cmdlets with listed parameters (Get-Content, Get-ChildItem, Select-String,
    Test-Path, Get-Item, Resolve-Path and filters like Select-Object) and programs with listed options (`rg`,
    `git status|diff|log|show`, and in POSIX shells `cat`, `head`, `tail`, `wc`, `ls`, `grep`, `find`). Anything
    else (variables, subexpressions, script blocks, redirection into files, wildcards in paths, other programs or
    options) asks. Every path it reads, the folder and Codex's own locations must be in the workspace or the repo,
    and a shell started by path must not be.
  - Every session gets Basis' own MCP server (`server/agent-tools.ts`), with the `screenshot` tool. The agent
    starts `server/agent-tools-mcp.mjs` with Node over stdio (the transport every ACP agent supports); the script
    has no dependencies and only speaks MCP's JSON-RPC, forwarding `tools/list` and `tools/call` to the chrome
    server at `/agent-tools/<project>/` on 127.0.0.1 with a secret made at each start (in the script's env), so no
    other program or page can use the route. Each project's server has its own URL (`toolsUrl`), so the tool
    photographs through that project's `screenshots` whichever project a tab shows: by default
    the narrowest width (for a specimen, the project's Mobile width) in both themes, at most four images, full pages cut at 2000 px with the cut said in the
    text. `onPermission` approves Basis' own tools without asking: Claude Code titles them `mcp__basis__<tool>`,
    Codex `mcp.basis.<tool>`, and Codex's approval request carries only the id of the tool call it reported
    before, so `AgentHost` remembers those ids. The chat shows such a call as "Screenshot of <target>".
  - After each turn it gathers problems (token validation, `tsc` against the contracts, review.json problems,
    render errors reported by the preview, views that do not render the same twice; see Checks) and sends them
    back to the agent, at most twice. It first waits for a report from the gallery reloaded after the turn (its
    generation, up to 10 s; `previewSettled`) and then for its checks; without one, the preview's errors and
    findings are left out, since they are from before the turn. A fresh gallery document reports its errors (often
    none) and its checks right after `ready`, counts as checking until it has first rendered, and the chrome drops
    the previous document's lists on `ready`. Every open tab
    reports its preview's errors with its visibility, to the project it shows (`OpenProject.report`, which takes
    reports only from tabs that show it); `server/previews.ts` picks the tab the user looks at (or looked at last),
    so a stale or second tab cannot send the agent after problems that are not there. While no tab shows a project
    whose agent works, `server/background.ts` (`BackgroundPreview`, started and stopped by
    `OpenProject.setShown`) plays the chrome in a page of the project's screenshot browser: the chrome server's
    `/background.html?port=<preview port>` embeds the gallery as the chrome does (a page Playwright makes up with
    `page.route` counts as public, and Chromium's local network checks then refuse it frames from localhost), gets
    the view from Basis on every `ready` (light, no review, the page with most of the turn's files,
    `pageForFiles`) and reports what the gallery reports as a hidden tab would. Until its first report it counts
    as a gallery still loading (generation -1, checking), so the fix loop waits for it.
  - A project has threads: chats of their own, each with its own agent session, all in the one agent process
    (`Thread` in `server/agent.ts`; ACP lets a process hold several sessions, and `onUpdate` and `onPermission`
    find the thread by the session id). They share the workspace, so their turns take turns: one queue for every
    thread, oldest first, each item naming its thread. The thread whose turn runs is `running`; the list
    (`threadList`, sent as `threads`) says per thread whether it is `working`, `waiting` for an answer or `queued`.
    A prompt goes to the thread the tab shows (the chrome tags what it sends with `thread`, as `App` tags the
    project), and guided turns go there too. Each thread's chat items go out tagged with it (`chat-upsert` and
    `chat-remove` carry `thread`), to every tab of the project; a tab keeps only the thread it shows, asks for
    another with `thread-open` and gets its chat back as `thread`, and names it in the bridge URL when it
    reconnects (`&thread=`). The thread shown last opens in a new tab and opens its session when the agent
    starts; the others open theirs at their first turn (`openSession`: `session/resume` of the thread's saved
    session when the agent is the same and supports it, else a new session with a notice when the thread has
    messages). Stop ends the running turn and drops what is queued in its thread only. New chat makes a thread
    (`newThread`, which reuses one nothing was asked in), named after its first prompt (`threadTitle`); an idle
    thread no tab shows can be removed. The agent (Claude or Codex) is the project's, since there is one process.
    Threads are saved in `.basis/threads.json` (the list, newest first, and the one shown last) and
    `.basis/threads/<id>.json` (each transcript with its agent and session id) by `server/chatlog.ts`; a workspace
    from before threads gets its `.basis/chat.json` as the first thread, and that file is left alone. Each agent
    commit carries its thread's title (`Basis-Thread`), which the history menu shows when there are several.
- The workspace, one module per concern, coordinated by `server/workspace.ts` (serial git queue, file watcher,
  events):
  - `setup.ts`: seeding from `template/`, migrations of older workspaces, generated files (`AGENTS.md`,
    `CLAUDE.md`, `tsconfig.json`, `.basis/`). A migration is recorded with source `upgrade`, which Undo never
    walks past (`undoStep` in `src/shell/history.ts`; older histories have it as `external` labelled "Basis
    added …"). `WORKSPACE_FORMAT` is written to `.basis/format.json`; raise it when an older Basis would misread
    a workspace a newer one has opened, and the older one then refuses it.
  - `template.ts`: keeping workspaces up to date with the starter template. `template/history.json` lists the
    hashes of every earlier version of each starter file, written from git by `npm run template:history`. On
    start, a unit of files that belong together (`Navbar.tsx`, `Navbar.module.css`, `Navbar.specimen.tsx`) is
    replaced with the current template when none of its files was changed, so a component never ends up with a
    new source and an old stylesheet. A workspace records the template version it caught up with in
    `.basis/template.json`; when it is behind `TEMPLATE_VERSION` and has changed starter files, the project menu
    offers a guided turn (`templateInstruction`) that brings in what `template/CHANGES.md` lists since that
    version, from a copy of the template in `.basis/template/`, and opens a review. Skip records the version too.
  - `history.ts`: one commit per agent turn, approved review, restore or hand edit, with `Basis-*` trailers.
  - `reviews.ts`: the open review (see below).
  - `snapshots.ts`: read-only copies of past versions in `.basis/snapshots/<commit>/`.
  - `paths.ts`, `exec.ts`: shared paths, git and tsc helpers.
  - `widths.ts`: the project's widths for Mobile, Tablet and Desktop (`shared/widths.ts`, defaults 375, 768 and
    1440) in `.basis/widths.json`: Basis' file, outside git, so Undo, restores and reviews leave them alone, and
    copied with a project. `Workspace.setWidths` saves them and emits `widths`; `OpenProject` sends them to the
    project's tabs at once (a `widths` message, never held like `design`) and tells `AgentHost`, which names them
    in every turn's context. The control next to Show at (in the preview, `FrameBar.tsx`) sends `widths-set`,
    which the chrome passes on only right after a user action in the frame, as with full screen; the server
    checks them again (`parseWidths`).
- `server/brief.ts`: the agent's instructions, also sent as an appended system prompt.
- `server/guidelines.md`: design guidelines distilled from WCAG 2.2, the ARIA practices, Material, Apple, GOV.UK,
  Carbon, Atlassian, Polaris, Spectrum and Nielsen Norman Group, written to `.basis/guidelines.md` on every start.
  The brief keeps the rules that always apply and sends the agent to the file's sections by name before it designs
  something; `test/guidelines.test.ts` fails when a section exists that the brief does not name, or the other way
  round. Where the big systems disagree the file picks one Basis default, so design systems made here agree.
- `server/export.ts`: the starter kit, as a zip from `GET /export/starter-kit.zip` or written into a folder.
- The verification kit (`server/verify.ts`, `server/capture.ts`, `server/verify-kit/`, `src/capture/`):
  - `capture.html` renders one screen of one view alone (`?view=&screen=&theme=`), one specimen's blocks as the
    gallery renders them without the section header (`?specimen=&theme=`, at the width the browser gives it), or
    lists every specimen, every view's screens and the shots their flow blocks ask for (`?list`, into
    `window.__basisCapture`; `&widths=` gives the project's widths for flows without their own, `listQuery`). It reads the tokens
    from `./design.json`: the preview server answers that path with the open design, and the kit's static copy
    has the file beside it. It sets `data-basis-ready` on `<html>` once fonts, images and the layout's size
    have settled, and `data-basis-error` when the screen threw. The chrome origin 404s it like `preview.html`.
  - `shared/capture.ts` turns a flow block's `capture` option into shots (widths, viewport height per width,
    full page or a fixed height, themes) and names their files.
  - `server/capture.ts` launches a headless browser (Playwright's Chromium, else Chrome, else Edge, through
    `playwright-core`) with flags that keep rendering the same (`CAPTURE_ARGS`), and takes every shot twice at
    device scale 1 with reduced motion (`CAPTURE_CONTEXT`, `takeShot`); two different images mark the shot
    unstable. `takeShot` also lists the images and media the page requested from another origin
    (`isRemoteMedia`), and `captureViews` measures the elements marked `data-basis-media` for each shot.
  - `server/screenshots.ts` takes screenshots of the live design for Basis itself, from the open project's
    preview server (`OpenProject.screenshots`): `capture({ specimen } | { view, screen? } | { id, screen? },
    { widths, themes, height })` returns the plan and the PNG buffers, `list()` what there is. `{ id }` takes a
    view's or a specimen's id or title. A specimen gets the defaults of a flow without `capture`, a view screen
    what its flow asks for, and given options replace them; the screenshot tool's limits (only the narrowest
    width, a cap on images, a cut height) are options too. It uses the kit's capture page and render settings,
    so its images look like the kit's. One browser and context stay open between calls
    (`Keeper`) and close a minute after the last one, or when the project closes. `repeat(files)` photographs
    every screen of the views in those specimen files twice at the first shot their flow asks for, the second
    time in a page of its own whose `Date` runs a day, an hour, a minute and a second ahead (`shiftClockScript`).
  - `server/verify.ts` builds `capture.html` with Vite into a temporary folder (the same aliases as the preview,
    `base: "./"`), serves it on a free local port, captures it, and returns the kit: `design/`, `screens/`,
    `basis-verify.json` (every shot and the render settings, the media marker, and the remote images a shot
    loads), a `.boxes.json` beside each shot, a README for the implementing agent, and the two scripts from
    `server/verify-kit/`. Images a view imports are built into `design/assets/` like any Vite asset. The chrome asks for it over the bridge (`verify-kit`), gets
    `verify-progress` and `verify-result` back, and downloads a zip from `GET /export/verification-kit.zip`; or
    the kit is written into `<product>/basis-verify/`, replacing only what Basis generates (`GENERATED`), and with
    `skill` its SKILL.md also into `<product>/.claude/skills/basis-verify/`, over a file there only when it has
    `SKILL_MARKER`.
  - For the agent that builds the views in the product: `server/verify-notes.ts` reads each view's source
    without an agent turn (`readView`, over `readSources` and the import helpers of `reach.ts`): where each
    screen's literal `go("id")` calls lead (`screenFlow`: the screen's render function or inline render and the
    file's top-level functions it names, each call with the text of the element it sits on), the names it
    imports from components, patterns and other files (through barrels by name), its images, every file it
    reaches, and the CSS variables those read, which `tokenRows` turns into the design's tokens and the ones their
    values refer to. `viewNotes` writes them to `views/<view>.md`, and the reached files are copied to `source/`.
    `server/verify-prompt.ts` writes `PROMPT.md` (goal, where things are, the views, how to build one) and
    `SKILL.md` (Claude Code's format) from one text for the loop, the image and exception rules and when to
    stop, plus the README's paragraph for `AGENTS.md`; all paths start at the product repo's root
    (`basis-verify/…`, `KIT_FOLDER` in `shared/capture.ts`). The Export tab's Copy prompt is
    `shared/kit-prompt.ts`, from the views the result lists (`viewList`).
  - `server/verify-kit/capture.mjs` and `compare.mjs` run in the product's repo with its own Playwright and no
    other dependencies: the first captures the design (served from `design/`) or the implementation (URLs from
    `targets.json`) with the manifest's settings, the second decodes the PNGs itself and compares them pixel for
    pixel, leaving out named exceptions from `exceptions.json`. Beside each image `capture.mjs` writes
    `<shot>.boxes.json`, the boxes of the elements the media marker (`MEDIA_SELECTOR`, `[data-basis-media]`) and
    the exceptions' selectors match (`boxesExpression`, a string so no loader's helpers reach the page);
    `compare.mjs` leaves those boxes out on both sides and fails the shot when the two sides do not have as many,
    at the same places and sizes (`shotExclusions`, exact unless `--box-tolerance`). Both scripts share these
    helpers through `compare.mjs`, the only module the kit's scripts import. Both take `--only <view>[/<screen>]`.
- `server/folders.ts`: choosing folders without typing paths. `pickFolder` opens the system's folder dialog
  (on Windows the Explorer-style `IFileOpenDialog` with `FOS_PICKFOLDERS`, through a small C# interop compiled by
  PowerShell's Add-Type, since FolderBrowserDialog is the old tree picker in Windows PowerShell 5.1, with a hidden
  topmost owner so it opens in front; `osascript` on macOS; zenity or kdialog on Linux, and a message to type the
  path when neither exists). `suggestRepos` finds git repos up to two levels into the usual code folders under
  the home folder, the most recently used first.
  The chrome reaches both through `POST /api/pick-folder` and `POST /api/repos`, which answer only POSTs from its
  own origin, so another page can neither open dialogs nor read the list. `FolderField` and `BrowseButton`
  (`src/shell/FolderField.tsx`) use them in the project dialogs and the export.
- `shared/`: `design.ts` (zod schema and defaults for `design-system.json`), `widths.ts` (the project's widths and
  their validation), `tokens.ts` (CSS variables and
  exports), `protocol.ts` (bridge messages), `frame.ts` (chrome-iframe messages, pages, and the parser for
  untrusted preview input), `review.ts` (review.json format), `contracts.ts`, `annotations.ts`, `diff.ts`.
- `src/` (chrome): `App.tsx` keeps the bridge, tags what each workbench sends with its project, and mounts
  `Workbench.tsx` once per project, which wires the
  parts; `shell/` holds the top bar and project menu, sidebar, history, inspect and review bars, dialogs,
  `PreviewFrame`, `useReview` and `prefs`; `chat/` holds the panel, the thread menu and the composer.
- `src/preview/` (iframe): `main.tsx` (messaging, picker, scroll spy, errors, link guard), `Preview.tsx`
  (foundations and specimen sections, or the review), `specimens.tsx` (glob and validation of
  `*.specimen.tsx`), `narrow.ts` (resolving review targets), `Review.tsx`, `Impact.tsx` ("also changed"),
  `progressive.ts` (rendering large pages in steps), `FullScreen.tsx` (a view alone in full screen).
- `template/components`, `template/patterns` and `template/views`: starter source with specimens (a view is a
  specimen with a `flow` block, rendered by `FlowBlock` in `specimens.tsx`); `template/contract-check.ts`
  proves the template satisfies the contracts, for components (`shared/contracts.ts`) and patterns
  (`shared/pattern-contracts.ts`, generic over the workspace's `IconName`, since icon names are the
  workspace's own and a contract may only import from react).

### Chrome and preview

The chrome sends the preview one `PreviewView` (`shared/frame.ts`: design, theme, page, review) whenever any of
it changes, and receives every preview message through one `onMessage` handler in `App.tsx`. A new preview
feature adds a field to `PreviewView` or a message to `FromPreview` (with its parser case), not a prop at every
layer.

**Full screen.** Full screen on a view's strip (only in the gallery, through `SpecimenSection`; reviews and
`capture.html` have no such button) sends `fullscreen-open`. The chrome takes it only while it has transient user
activation (`navigator.userActivation`, which the browser passes up from a click in the frame), so the preview cannot
cover the window on its own, and puts it in `PreviewView.fullscreen`. `PreviewFrame` then makes its canvas fill the
window over the chrome and asks the browser for full screen on the iframe element. The parent asks, so the iframe
needs no `allow="fullscreen"` and the sandbox stays as it is; where the browser refuses (the Claude desktop app's
pane), the window-filling canvas is the full screen. The iframe element is what is in full screen, not its
document, so the reload after a turn stays there. In the preview, `FullScreenLayer` renders the view's current screen over the
gallery (fixed, scrolling on its own; the gallery underneath does not scroll or take focus, but it is still rendered
and checked), on a `.ds-root` that is a size container at the full width and a form of its own, like a Show at
frame. Moves stay in the preview, since every render message brings a new design object and reruns the checks; the
place (view, screen, theme) is kept in the frame's `sessionStorage` for the next document. Esc in the browser's full
screen ends it there (`fullscreenchange`); outside it, the preview's or the chrome's Esc, or the bar's Exit, send
`fullscreen-exit`. On exit every copy of the view's flow in the gallery moves to the screen reached
(`FullScreen.left` in `specimens.tsx`) and the gallery scrolls to the view. The bar is Basis' and lives in a shadow
root with its own stylesheet (`FullScreenBar.css`), so the design's CSS and Basis' cannot meet. A view's screen is
the whole page, its padding and shell included: the gallery's frame around it (`.flowScreen`) adds no padding, so
the gallery, full screen and the kit's capture page show the same page. The starter view puts each screen in a
`Page` of its own (AppShell `contained` in a grid at least as tall as the window, so the page grows and scrolls as a
whole, and content at most 1200px wide with side padding in `cqi` of the shell); its layout is inline, since a
template update only replaces files a workspace already has.

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
which are size containers at the project's widths (`ProjectWidths`, from `PreviewView.widths`), sized as content
boxes so the content gets exactly the width shown with the frame's padding outside it; a view's screen
(`.flowScreen`) draws its edge as an outline for the same reason. The gallery's Show at bar uses the same frames, and can also show both themes; a
review shows one theme at a time (Lucas prefers toggling), which starts from the system theme. Blink
stacks the panes in one grid cell and hides all but one; the panes of a view's target share its flow position
(`FlowSync` in `specimens.tsx`), so every side shows the same screen; the chrome forwards the B key to the preview, so it
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

Accessibility (`src/preview/a11y.ts`, which also runs the layout check below) runs axe-core over elements marked
`data-checked` (each specimen's demos and the review's live panes, never past versions, foundations or the
offscreen impact copies), 600 ms
after anything that changes them, and keeps serious and critical WCAG A/AA violations, one per demo and rule so
the text stays stable for the comparison. Duplicate-id rules are off, since the gallery repeats demos. While a
check is scheduled or running the preview says so, and the fix loop waits for it (up to 8 s after the reloaded
gallery reported) before it decides what the turn introduced; the copy in the other theme counts as running from
when it is embedded until it first reports. The user sees one theme, so the preview keeps a copy of
itself in the other one (`ThemeChecker` in `src/preview/main.tsx`): a same-origin frame at full size, transparent,
inert and behind the page, opened with `?theme-check`. It renders the same view without impact copies and posts
only its own axe findings, which join the preview's. Every finding names its theme, taken from the nearest
`data-theme`, so the two documents (and the gallery's both-themes frames) agree on the text and repeats drop out.
The copy turns off transitions and animations, since a hidden frame does not play them and a theme switch would
leave colours halfway; the preview's CSP allows `'self'` as a frame ancestor for it. The gallery's own labels
(group titles, column heads, captions) are excluded from axe: they use `textSubtle` at small sizes, which fails
4.5:1 in the light default, and they are Basis' text, not the agent's.

Layout (`src/preview/layout.ts`, with the pure parts in `shared/layout.ts`) runs in the same pass over the same
demos and reports as its own check, `Layout`. Each demo is judged in its frame: a Show at frame (marked
`data-frame` with its width) or, unframed, the section or review pane around it. Three rules: content past the
frame's edge, or a box in the design that scrolls sideways (scroll snapping marks a deliberate strip and is left
alone); text cut off by `overflow: hidden` or `clip` where the box has no `text-overflow` ellipsis (sideways) or
line clamp (vertically), judged on the text's own line boxes so clipped images and visually hidden text do not
count; and axe's `target-size` rule (WCAG 2.5.8, off by default in axe, enabled in the same axe run since axe runs
one at a time), which exempts links in running text and small targets with enough space around them. The gallery's
own wrappers and scroll areas (the matrix that scrolls on a phone on purpose) never count, and invisible content
(a tooltip until hovered) does not count as past the edge. A Show at frame is judged by its content box (the width shown,
without the frame's padding). Findings name the demo, theme, width and an example element, one per demo, theme,
width and rule. The copy in the other theme always adds the project's Mobile width to its frames, the review's
live side included, so a phone is checked whatever widths the user looks at. When the user changes the widths,
`AgentHost.widthsChanged` notes the new ones until the preview has reported checks running and then done; a
turn that starts before that, or during which they change, does not get layout findings at those widths (they
name their width, `findingWidth`). A check run that ends while another is scheduled reports itself as still
running (`scheduled` in `a11y.ts`), so a quiet report always covers what the page shows. The fix loop sends introduced layout findings in a
section of their own that points at the screenshot tool.

Views that render differently each time (`server/stability.ts`) are problems rather than findings, since such a
screen can never pass the verification kit, so they are sent while they last. `Workspace.turnFiles` lists what the last turn changed (the
working tree as a git tree when the turn begins and when it ends, so a review's iterations and a hand edit before
the turn do not count). When that includes a file in `views/`, the fix loop finds the view specimens it reaches
through their imports (`reach.ts`), has `Screenshots.repeat` photograph their screens, and compares each pair
with the kit's own `compareImages`. The check runs while the loop waits for the preview to settle, so it costs
only what it takes beyond that; a turn that changed nothing in `views/` takes no screenshots. A screen that
differs is reported in its own section, and one that throws joins the render errors unless the preview already
names its view's section. The views found wrong are checked again after the fix-up turn even when it changed
other files. The texts name screen, view, file, width and theme and nothing else, so they stay the same while the
problem does. Without a browser, or when the capture page does not settle, the check finds nothing and says why
once on the console. The same pass reports a screen whose first capture requested images or media from another
origin (a `request` listener in `takeShot`, so URLs from data files, `srcset` and CSS count as much as an `src`), in
a section of its own that sends the agent to a placeholder in `views/assets/` marked `data-basis-media`. Fonts and
stylesheets are not media, so Google Fonts pass. Images in the source folders are part of `reach.ts`'s graph (as
files with no imports), so a changed placeholder reaches the views that import it.

Fixed colours (`shared/fixed-colors.ts`) are found on the server in `Workspace.check()`: hex, colour functions
with literal channels, and white/black in tokens outside `color` (typography is skipped) and in the source
folders' stylesheets (masks and font properties are skipped). Such a colour is the same in both themes. The
findings are part of `DesignState` (`colorFindings`); the chrome lists them with the preview's checks, and
`AgentHost` treats them like those: only the ones a turn introduced reach the fix loop. Shadows follow the theme
through the `shadow` role, whose alpha is each theme's strength, mixed into the shadow tokens with
`color-mix(in srgb, var(--color-shadow) N%, transparent)`.

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
npm run test:e2e     # Playwright: the app in Chromium, each test with its own Basis and a stand-in agent
```

- **Tests** live in `test/`. `workspace.test.ts` runs real git in throwaway folders and stubs the type check
  (`new Workspace(dir, { typecheck })`). Add a test with every change to history, reviews or migrations: that
  code restores and deletes files in the user's workspace.
- **End-to-end tests** live in `test/e2e/` (`*.spec.ts`, run by Playwright; `npx playwright install chromium`
  once). The `basis` fixture in `test/e2e/basis.ts` starts a Basis per test with a throwaway workspace on port
  5400 and `BASIS_AGENT_SCRIPT` pointing at `fake-agent.mjs`, a stand-in ACP agent that moves
  `motion.duration.fast` by 10ms through the client's file methods (a timing token, so the checks find nothing to
  fix) and opens a review of Buttons when the prompt contains `E2E-REVIEW` (the file's header lists the other
  markers; `E2E-WHO` names the session and whether it was resumed, which `test/agent.test.ts` uses to check that
  threads resume their own sessions after a restart). The gallery is a cross-origin iframe;
  Playwright reaches into it with `gallery(page)`. CI runs them on Linux and keeps traces of failures.
- **Before restarting the dev server**, check that no agent works, in any open project: a turn in flight is lost. A
  small Node script connecting to `ws://127.0.0.1:5320/bridge` with header `origin: http://localhost:5320` gets a
  `hello` message containing `agent.status` of the project it shows and `status`, which names every project whose
  agent is `working` or `waiting`. The chats and an open review survive the restart.
- **To kill the server on Windows:** `Get-NetTCPConnection -LocalPort 5320 -State Listen | % { taskkill /PID $_.OwningProcess /T /F }`
  (the previews of every open project run in the same process).
- **Test changes that touch the agent or the workspace** in a separate instance with a throwaway workspace:
  `PORT=5330 BASIS_WORKSPACE="$TEMP/basis-test-ws" npx tsx server/index.ts`. `BASIS_WORKSPACE` opens just that
  workspace and never touches the saved project list. To test projects themselves, give the instance its own
  home instead: `PORT=5330 BASIS_HOME="$TEMP/basis-test-home" npx tsx server/index.ts`. A home of its own starts
  with a new project in its `workspaces/` folder; before 2026-10-18 it adopted `workspace/` in the repo, which is
  the maintainer's real workspace. Stop it and delete the folder afterwards.
- **Verify in the built-in browser.** The parent cannot read the iframe's DOM (by design), so check preview
  content with screenshots and zoom, or through what the chrome shows (sidebar, problems list, chips).
- **Verify the export** by unzipping the kit into a temp app with a `tsconfig` whose `paths` point at Basis'
  `@types/react` and a Vite config aliasing react, then running tsc and vite build.
- **The first `npm run dev` after 2026-10-18** moves a project list kept in the repo root to `~/.basis`; the
  projects themselves stay where they are.

## Releasing

Basis is published to npm as `basis-design`, with the command `basis` (`bin/basis.js`, which loads the
TypeScript server through tsx). Publishing is the maintainer's call.

- Everything the app needs at run time is a dependency, not a dev dependency: tsx, vite and its React plugin,
  typescript (the workspace type check) and `@types/react`/`@types/react-dom` (the workspace `tsconfig` points at
  them). `files` in package.json lists what ships; tests, docs and CI stay out.
- **Verify the package before publishing**, from a real install: `npm pack`, `npm install <tarball>` in an empty
  temp folder, then `BASIS_HOME="$TEMP/x" PORT=5340 ./node_modules/.bin/basis`. Check that the gallery renders,
  the workspace type check is clean and a real agent turn lands. An install hoists dependencies above Basis'
  folder, which a checkout never does.
- The README's logo is the relative `src/icon.svg`: npmjs.com resolves it through the public repository.
- `docs/social-preview.png` (1280×640) is the repository's social preview. GitHub takes it only through the
  web UI: Settings, General, Social preview.
- Bump `version`, update the README, then `npm publish`.

## Gotchas

- **TypeScript 7 has no JavaScript API**, so typescript-eslint cannot run; linting is oxlint, which honours the
  existing `eslint-disable` comments.
- **Backslashes in generated code:** the Bash tool mangles them inside heredocs and Python `-c` strings, so
  `"\n"` turned into a real newline several times. Use the Edit/Write tools for code containing backslashes.
- **Paths into node_modules:** resolve packages with `require.resolve`, never by joining `node_modules` onto
  Basis' folder; an npm install hoists them above it.
- **CRLF:** files in the Windows checkout are CRLF (`core.autocrlf=true`); seeding normalises templates to LF,
  and Prettier runs with `endOfLine: auto`.
- **Workspace git:** it runs as user "Basis" with `core.autocrlf=false` (see `server/exec.ts`).
- **Container queries in patterns:** Navbar is its own size container: under 1024px its search becomes a button
  that opens the field below the bar, under 800px links, search and actions move behind the menu button. A
  gallery at Fit on a laptop is about 900px wide, which is why the middle step exists. AppShell is the container `app-shell`, and SidebarNav becomes its rail only inside a narrow one, so a
  sidebar on its own keeps its width. Both layouts of the Navbar are rendered and CSS shows one, so search and
  actions exist twice in the DOM (one hidden).
- **OAuth refresh races:** several Claude Code processes at once (a dev instance, a test instance, a Claude Code
  session, and every open project's agent) can make a turn fail with "another Claude Code process is refreshing
  it". It is transient; retry. Codex agents of several projects share Basis' Codex home and its linked `auth.json`,
  as several Codex sessions on one machine share `~/.codex`.
- **Hidden tabs:** rAF does not run in background browser tabs, so do not gate chrome-iframe messaging on rAF.
- **StrictMode:** it remounts class components in dev. `SectionBoundary` reports from mount and update so
  problems survive that.
- **Fast Refresh** does not retry failed error boundaries on its own; sections reset on `vite:afterUpdate`. A
  module that exports anything but components (Review.tsx once exported a helper) reloads the whole preview.
- **A module that failed its first load takes no more updates:** Vite's client drops updates for a module it never
  ran, and a new file that failed to parse never had its imports read. That is why a turn holds the preview and
  reloads it at the end rather than letting it hot-update through half-written files. Vite also broadcasts every
  transform error to every page, so while held the gallery ignores `vite:error` and hides Vite's overlay
  (`data-basis-held`), and reloads at the release if it ignored one.
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
- **New starter patterns:** older workspaces already have `patterns/`, so seeding skips it. A pattern added to the
  baseline contract later goes in `LATER_PATTERNS` (`server/setup.ts`): a workspace without its `.tsx` gets its
  files and an export appended to `patterns/index.ts`. Use only icon names from the first icon set in such a
  pattern and its specimen, since the workspace's `icons.tsx` is its own.
- **Changing the template:** after any change in `template/`, run `npm run template:history` and commit
  `template/history.json`; `test/workspace.test.ts` fails until you do. When the change is worth bringing into
  workspaces whose agent changed the files, raise `TEMPLATE_VERSION` (`server/template.ts`) and describe the
  change under a new heading in `template/CHANGES.md`, written for the agent: what changed and where.
- **Vite remembers removed files:** a snapshot copy deleted and written again at the same path while the
  preview server runs gives 404s. Copies are therefore only pruned at start-up, and the chrome forgets its
  cached past versions when a review ends or the server says hello again.
- **`.ds-root` fills the viewport** (`min-height: 100vh`) as the page root; review panes and width frames, which
  are `.ds-root` too, reset it.
- **Capture readiness:** the capture page's `<html>` counts as hidden to Playwright while it has no visible
  content (the `?list` mode), so wait for `html[data-basis-ready]` with `state: "attached"`. `capture.mjs` repeats
  the page's settling logic (`markReady` in `src/capture/main.tsx`) for the implementation's pages; change both
  together.
- **Screenshots only match on the same machine:** fonts, hinting and antialiasing differ between operating
  systems, so the kit's README has the implementing agent capture the design and the implementation with the same
  browser on the same machine; `screens/` is the reference only when nothing else is there.
- **No form submits in the preview:** its sandbox has no `allow-forms`, so a `<form>`'s submit (Enter in a field
  included) is blocked before any `submit` event. Handle Enter on the fields, as the widths control does.
- **Section ids** must stay under 80 characters: the chrome truncates longer ones from the preview. Repeated ids
  become `id-2`, `id-3` (they used to grow as `id-2-2-2`, which broke navigation with many duplicates).

## Working with the maintainer

Basis is maintained by Lucas Skog. These are the conventions for changes, by people and agents alike; agents
working with Lucas also reply to him in Swedish.

- Code, commit messages and docs are in English. No AI attribution or Co-Authored-By trailers.
- Commit and push only when asked. Commit messages explain why, with a body listing the main changes.
- Ask before deleting a user's data. For bigger features, sketch the user flow (what starts it, the loop, what
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
   a time, each with its own agent session: done. Since 2026-10-19 several stay open at once. This is the base for linking Basis to real projects (reading
   a product repo's context, designing views for one of its features).
7. Scaling the preview: pages render progressively, and "also changed" checks only the sections a review can
   reach: done. Specimen modules still load up front; at 230 ms for 86 sections that was not the bottleneck.
8. Comparing better: blink mode in reviews; pattern states (the `states` block) plus widths and both themes
   through container frames; several alternatives side by side, picked with ×2/×3 by Send: done.
9. The roadmap in `docs/ROADMAP.md`, worked through by a loop: contrast and axe checks in the fix loop, contracts
   for patterns, linking a product repo (bring in its design system, create a project from it, `product.md` as
   the agent's memory of it), and views (a Views page, New view from a feature or ticket, views in reviews):
   done. Its decision log records why things are the way they are.

10. Release readiness (2026-10-18): symlink-safe path checks, a host check against DNS rebinding, the agent
    isolated from the user's own Claude Code setup and started in the mode that asks, Codex tested on the new
    adapter, pinned adapter versions and `engines`, clearer start-up and agent errors, reduced motion and
    described field errors in the template, starter patterns that respond to narrow widths, Undo that stops at
    Basis updates, a workspace format version, CI on three systems, and the chrome's own axe findings fixed. A
    new project now starts without accessibility findings (two small texts in the starter patterns used
    `textSubtle`, which is held to 3:1, and failed 4.5:1 in the light theme).
11. Packaging (2026-10-18): the name stays Basis, published as `basis-design` with the command `basis`; Apache-2.0
    for the app and MIT-0 for `template/`; projects in `~/.basis`. Verified from a packed and installed tarball.
    Not published yet.

The next step is Lucas' call. Left for later: syncing tokens and components forward into a linked repo, visual
comparison of the whole gallery between two history entries, the icon, and publishing.

## Known limits

- **Inspecting a past version** (history menu) shows that version's tokens with today's component code. The
  banner says so, and Restore brings back both. Reviews run a past version's real code from
  `.basis/snapshots/`, and inspect could reuse that.
- **Impact noise:** a specimen whose demo changes on its own (timers, random data) would always show under
  "Also changed". None of the starter specimens do.
- **Reach is static.** A specimen that reads token values from its `design` prop in JavaScript, rather than
  through CSS variables, is not found by `reach.ts`; its section is then left out of "Also changed".
- **Codex** on macOS and Linux runs read-only commands in its sandbox without asking, even in read-only mode.
  Such reads do not reach Basis' approval as Claude Code's do; whether its sandbox lets them read outside the
  workspace has not been tested. On Windows it asks before every command instead, since Basis' Codex home has no
  Windows sandbox; Basis approves the reads it can tell apart (`server/commands.ts`), and a read it does not
  understand still asks: a wildcard in a path (`Get-Content *.css`), `ForEach-Object` or `Where-Object`, a
  variable, a pipe into an unlisted cmdlet, or a program other than `rg` and `git`. A user whose Codex login is
  not in `auth.json` gets Codex with their own AGENTS.md and config.
- **The stable-views check** runs only after a turn that changed `views/`, so a component or pattern that starts
  reading the clock is found when a view next changes, or when the verification kit is built. It follows imports
  as `reach.ts` does, which needs the file extension (`./team-data.ts`, as the template writes them).
- **Git in the linked repo:** Claude Code asks before a git command that names another folder (`git -C <repo>`,
  `cd <repo> && git ls-files`), even in its working directories; that is its own check, and the request reaches
  Basis as a plain shell command. Basis leaves it to the user; the brief steers the agent to `ls`, `find`, `grep`
  and its own tools.
- **The export dialog** closed by itself once during testing, and it could not be reproduced.
- **Binary images in past versions:** snapshot copies (`server/snapshots.ts`) are written from `git show` as text,
  so a PNG or JPEG in `views/assets/` shows broken on a review's before side. The brief has the agent write SVG
  placeholders, which are text; a user's own binary image would need snapshots written as buffers.
- **Images used from CSS** (`url(./assets/x.svg)` in a `.module.css`) work in the preview and the kit, but
  `reach.ts` does not follow `url()`, so changing only such an image does not reach its view.
- **The kit's notes read source, not the running view.** A `go()` with a computed screen id, a screen rendered by a
  function from another file, or `go` passed under another name is not in the flow; the tokens are those of whole
  files, so a file with several components (`Display.tsx`) brings the tokens of all of them.
- **Pattern links** default to `href="#"` when no `href` or `onNavigate` is given. The preview's link guard
  makes that harmless in the gallery.
