<img src="src/icon.svg" width="72" height="72" alt="">

# Basis

Prompt a complete design system into existence, then refine it down to the last transition.

Basis is a local web app with two halves. On the left you talk to a coding agent, either Claude Code or Codex. On the right is a live specimen of your design system: colour roles with contrast checks, type, spacing, shape, motion, and every component in every state (default, hover, pressed, focus, disabled, loading, invalid, checked, indeterminate…). Start broad ("warm editorial, serif headings") and go as deep as you like ("softer button press", "make the tab indicator slide").

The agent owns both the tokens and the component source, so the result is a real starting point for a project rather than a theme.

The agent runs over the [Agent Client Protocol](https://agentclientprotocol.com) on your machine, using the CLI login you already have. You need no API keys, and usage runs on your own Claude or ChatGPT subscription.

## Run it

```bash
npx basis-design
```

Or install it once with `npm install -g basis-design` and start it with `basis`. Open http://localhost:5320. Basis starts Claude Code by default (shown as Claude in the picker above the chat); switch to Codex there. Basis needs Node.js 22.12 or later and `git` on the PATH.

- **Claude Code:** install it and log in once with `claude` in a terminal. Basis runs your own Claude Code through `@agentclientprotocol/claude-agent-acp`, which npx fetches on first use without a copy of Claude Code of its own. If Basis does not find it, set `CLAUDE_CODE_EXECUTABLE` to its path.
- **Codex:** log in once with `codex login`. Basis starts it through `npx @agentclientprotocol/codex-acp`, at a fixed version that npx fetches on first use.

Usage counts against your own plan. A turn can take up to three agent runs (the turn and up to two fix-ups), and ×2 or ×3 alternatives multiply that.

To work on Basis itself, clone the repository and run `npm install` and `npm run dev`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASIS_HOME` | `~/.basis` | Where the project list (`basis.projects.json`) and new projects (`workspaces/`) live |
| `BASIS_WORKSPACE` | | Opens just this workspace for one run, without touching the project list (for tests and one-off use) |
| `BASIS_AGENT` | `claude` | Agent started on boot (`claude` or `codex`) |
| `PORT` | `5320` | Port of the Basis app (bound to 127.0.0.1 only) |
| `BASIS_PREVIEW_PORT` | `PORT + 1` | Port of the sandboxed preview origin of the first open project; others get free ports |

## Projects

Each project is a workspace of its own: its own design system, history, chat and review. Switch, create and open projects from the menu with the project's name at the top left. Several projects run at once: switch away while the agent works and it goes on in the background.

A project can link the **product repo** it designs for (project menu, **Link product repo…**): pick it from the repos Basis finds in your usual code folders, choose it with **Browse…** in your system's folder dialog, or paste its path. The agent reads and searches it without asking, also with shell commands that only read (`ls`, `find`, `grep`), to match the product's look, components and terms, and never writes there: its edits in the repo are refused without asking you, and writes outside the workspace are refused. **New project…** can also start from a product repo: the project takes the repo folder's name unless you give one, links the repo and starts by bringing in its design. **Bring in its design** (offered when you link, and in the project menu) starts a guided turn: the agent maps the repo's tokens onto `design-system.json`, restyles the components and patterns to resemble the product's, writes what it learned to `product.md` (where the tokens live, an inventory of the product's components and their Basis counterparts, terms to reuse) and opens a review.

- **New project** starts from Basis' defaults, or as a copy of the open project's tokens and components (not its history). It lives in `~/.basis/workspaces/`.
- **Open folder** adds a workspace from anywhere, or an empty or new folder for Basis to set up, inside a product repo for instance; a folder inside a git repo links that repo as the product repo (Unlink in the project menu undoes it). Basis refuses a folder that already has other files, so it never starts a history in someone's project.
- Switching never waits. The project you leave stays open, its agent working, and the project menu says which projects are **working**, **waiting for approval** (the agent asks before a command, and is stuck until you answer) or **done** (a turn ended while you looked elsewhere). A dot next to the project's name says so with the menu shut: red when another project waits for you. A project you have not shown for ten minutes, whose agent has nothing to do, closes; opening it again resumes its conversation, so the agent remembers where you were. The unsent message in the chat and the export's target folder are kept per project.
- When Basis' starter components improve, the files a project never changed update by themselves. For the ones the agent changed, the project menu offers a guided turn that brings the improvements in, as a review, keeping the project's own look.
- Removing a project from the list never deletes its folder. Earlier versions kept the project list in the Basis folder; it moves to `~/.basis` on first start, and its projects stay where they are. The `./workspace` of versions before projects becomes the first project.

## The workspace

```
workspace/
  design-system.json     tokens, validated against shared/design.ts
  components/            React + CSS Modules source of every component (seeded from template/)
    *.specimen.tsx       how the gallery shows each component: one section per specimen
    contracts.ts         the API of every component added beyond the Basis baseline
  patterns/              larger building blocks composed from components/ (seeded from template/)
  review.json            written by the agent to open or update a review (not in history)
  product.md             what the agent learned about a linked product repo
  .git/                  history: one commit per agent turn, approved review, restore or hand edit
  AGENTS.md, CLAUDE.md   the agent's instructions (generated)
  tsconfig.json, .basis/ type-check setup and contracts (generated), the open review, its snapshot, the chat
```

The agent may edit `design-system.json`, `review.json` and anything under `components/` and `patterns/`, and nothing else. Components style themselves with the token CSS variables, so tokens stay the single source of truth for look and feel. Component code covers structure and behaviour. A component the agent adds gets a token group of its own under `components` in `design-system.json` (`components.starRating.iconSize` becomes `--star-rating-icon-size`), so it is tuned, reviewed and exported like the baseline ones.

Every `components/*.specimen.tsx` file becomes a gallery section and a sidebar entry. A specimen lists blocks: a `matrix` of variants × states, a `grid` of labelled examples, a pattern's data `states` (populated, empty, loading, error, long content), or free `row` and `block` content for live demos (the format is in `components/specimen.ts`). The agent writes specimens alongside components, so a new component or variant shows up in the gallery as soon as it exists. Basis owns only the foundation sections: colour, type, shape and motion.

`patterns/` holds composed components such as Navbar, SidebarNav, PageHeader, DataTable with Pagination, StatCard, FormSection, EmptyState, AppShell, and for AI products a Composer and a chat (ChatThread, ChatMessage, ChatWelcome). They import only from `../components`, have their own specimens, and appear on the gallery's **Patterns** page, which you switch to in the top bar. The agent edits and extends them like everything else, so a token or base-component change flows through to every pattern. **Show at** above the specimens renders every block at mobile, tablet or desktop width and in both themes at once. Each copy is a size container, so patterns respond with `@container` rules to the width they are shown at.

`shared/contracts.ts` (copied to `.basis/contracts.ts`) is the baseline API every design system keeps. A component can change completely and gain props or variants, but it must keep its export and accept the contract's props. Components the design system adds get their contract in `components/contracts.ts`, which the agent writes when it creates them; every export of `components/index.ts` needs a contract in one of the two files. Patterns work the same way: `shared/pattern-contracts.ts` (copied to `.basis/pattern-contracts.ts`) is the baseline for the starter patterns, and `patterns/contracts.ts` holds the contracts of patterns the design system adds.

`views/` holds **views**: whole screens of a product's flows, built only from the components and patterns, on the gallery's **Views** page. A view is a specimen with a `flow` block: its screens show one at a time with a strip to jump between them, and buttons in a screen move through the flow (a row opens its detail, Save goes back). Views fill with realistic made-up data, and they are left out of the export: they prototype a product, they are not part of the design system. **New view** at the bottom of the Views sidebar takes a name and the feature, or a whole ticket, and starts a guided turn: the agent works out the screens, builds the flow from your patterns (adding a pattern when one is missing), and opens it in a review. A review of a view can show just some of its screens, and its panes move through the flow together, so before and after, blink and alternatives always compare the same screen.

**New component** and **New pattern** at the bottom of the sidebar ask for a name and what it is for, then start a guided agent turn: it checks for an existing component with the same job, creates the source, contract (for base components), export and specimen, and the result appears in the gallery. You can ask for the same thing in the chat.

## How it works

- **Live preview:** the gallery runs on its own origin (`BASIS_PREVIEW_PORT`) in a sandboxed iframe, because it executes code the agent writes. That code cannot reach the bridge to the agent or the Basis UI. Vite compiles `components/` on the fly, so saved edits hot-reload in place, and token changes arrive over `postMessage`. While the agent works, the gallery keeps showing the design as it was before its turn ("Changes show when the agent is done"), so half-written files and imports of files not written yet never show up as errors; when the turn ends it reloads once, where you were scrolled to. The agent's own screenshots see its work as it goes.
- **Problems loop:** after every turn Basis validates the tokens, type-checks `components/` and `patterns/`, checks the components against their contracts, and collects render errors and malformed specimens from the preview once it has reloaded with the turn's result. A broken section shows its error instead of taking down the gallery. Anything wrong is sent back to the agent automatically, at most twice per turn, and is listed above the composer. After a turn that changed a view, Basis also photographs each of its screens twice, the second time with the clock a day later, and sends the agent the screens that came out different (a clock, random values, an animation that does not settle) or failed to render, since the verification kit could never match them, and the screens that load images from other sites; a turn that changed no view skips this.
  - **Accessibility checks** run alongside: the colour roles are checked for WCAG 2 AA contrast in both themes, and axe-core checks the live demos (gallery sections and the review's live side) for serious and critical WCAG A and AA violations once the preview settles. A layout check looks at the same demos at phone width (375px) and at the widths the gallery shows: content that runs past the edge or scrolls sideways, text cut off without an ellipsis or line clamp, and controls smaller than 24 by 24 px (WCAG 2.5.8). Findings are listed apart above the composer, with a button to ask the agent to fix them. The agent hears only about findings its own change introduced, so an existing one does not send it off on every turn, and a colour you asked for on purpose is kept.
- **The agent sees its work:** Basis gives the agent a screenshot tool that photographs a specimen or a view's screen from the live preview, by default at the narrowest width it is shown at and in both themes. The agent is told to look after every visual change and before it opens a review, so it catches clipped labels, overflow and a theme that reads wrong before you do. The screenshots are taken with the same browser as the verification kit's (see below).
- **History:** the workspace is a git repository. Each agent turn becomes one commit, labelled with its prompt and with the tokens and files it changed. Click an entry to inspect it. The preview shows that version's tokens, and a banner lists the token and component-code differences from now. You can step through versions or restore one; restoring brings back tokens and code alike. Undo walks back through the steps instead of toggling between two of them.
- **Reviews:** ask for something specific ("make the danger button feel more urgent") and the agent opens a review once it has a first version, by writing `review.json`. The preview then shows just that, narrowed to a block and its rows or columns, as it was when the review started next to how it is now. You keep iterating in the chat until you **Approve** (everything becomes one history entry) or **Discard** (everything goes back).
  - While a review is open, every agent turn and hand edit becomes an iteration of it, not a history entry. Iterations live on a git ref outside the history, so you can go back to an earlier one, and the review survives a restart. Undo and History wait until the review ends.
  - The "before" side runs the starting point's own component code with its own tokens, from a read-only copy in `.basis/snapshots/`. If the agent adds a block to show a new state, the before side runs today's demo on the starting point's components, so it still compares old with new.
  - **Also changed** lists other sections that now look different, found by rendering them before and after offscreen and comparing structure and computed styles. Only sections the change can reach are checked: those whose specimen, through its imports, uses a changed file or a CSS variable whose value changed. Tokens are global, so this is where you see what else a change reached; click one to add it to the review.
  - A review shows its targets **side by side**, **stacked**, or with **blink**, which shows one version at a time in the same place so subtle differences stand out: click a pane or tap B to switch, hold B to see before, or let it switch by itself. A target can ask for widths, like Show at; it shows one theme at a time, and you switch with Light and Dark in the top bar.
  - **Alternatives:** pick ×2 or ×3 next to Send, and the agent makes that many takes on the request, one after another from the same starting point. The review shows where they started next to each one, and **Continue with** in the review bar picks the one to keep iterating on. Each take is an iteration, so the others stay reachable.
  - Approve waits while the agent works, while there are problems, or until an alternative is chosen. Errors on the before side are shown in place and never sent to the agent, and Pick only attaches components from the live side.
- **Composer:**
  - The conversation survives a restart, and Claude Code picks up the same session, so it remembers what was said.
  - Messages sent while the agent works are queued and run, in order, when it is done; remove one with its ×. Stop drops the queue too, and ends a set of alternatives after the take being made.
  - Up and Down recall earlier messages, and an unsent message survives a reload.
  - Paste, drop or attach images. They are sent as ACP image blocks when the agent supports them.
  - Press **Pick** and click components in the preview. Each pick is attached as a numbered annotation carrying its variant, state, theme, driving tokens and computed styles, so "make [1] softer" is unambiguous. Pick mode stays on until Done or Esc, and you can click a component again to remove it.
- **Layout:**
  - The sidebar scrolls the preview to each section and can collapse to an icon rail.
  - The chat can be resized by dragging its edge (double-click resets) and hidden with the toggle in the top bar or Ctrl+B.
- **Permissions:** reads inside the workspace and edits to the files the agent may change are approved automatically. Anything else, such as shell commands, web fetches or other files, shows up in the chat for you to approve. Paths are compared after following links, so a link inside the workspace that leads out of it is not approved.
  - The agent always starts in the mode that asks: Claude Code in its default mode and Codex in read-only mode, whatever your own settings default to. On macOS and Linux, Codex still runs read-only commands in its sandbox without asking. On Windows it asks before every command; Basis approves the ones that only read files in the workspace or the linked repo (such as `Get-Content`, `rg` or `git diff`), and anything it cannot tell is a read still shows up for you.
  - Claude Code runs without your own `~/.claude` setup (CLAUDE.md, skills, hooks, permission rules, claude.ai connectors and auto memory), so rules meant for your coding neither steer the design agent nor approve anything for it. Basis' instructions arrive as its system prompt.
  - Codex runs without your own `~/.codex` setup (AGENTS.md, config, skills, plugins, MCP servers, hooks, rules and memories), in a Codex home of Basis' own (`~/.basis/codex`), so it also uses Codex's default model rather than the one in your config. Only your login is shared: its `auth.json` is a link to yours, so nothing is copied. When your login is not in `auth.json` (Codex keeps it in the system keyring), Codex runs in your own home instead, with skills, apps, plugins, memories and hooks turned off but your AGENTS.md and config still read.
  - A linked product repo is read without asking, so text in it can steer the agent like any prompt. Approve shell commands with that in mind.
- **Export:** the **Starter kit** tab packages the whole design system for a new project. You can download it as a zip or write it straight into a project folder; if any file there would change, nothing is written until you confirm. The kit contains:
  - `components/`, with imports rewritten to extensionless form so any bundler and default `tsconfig` accept them,
  - `tokens.css`, CSS custom properties with dark mode via `data-theme` or the OS setting,
  - `theme.tailwind.css`, a Tailwind v4 entry stylesheet,
  - `design-system.json`,
  - a README on wiring it up.

  The kit needs React 18+ and CSS Modules, nothing else. The other tabs export the token formats one at a time.
- **Verification kit:** proof that a feature was built as its view shows. The **Verification kit** tab photographs every screen of every view at fixed widths (375, 768 and 1440 pixels, full page, unless the view's flow block sets `capture`) and packages the screenshots with a static, clickable copy of the design and two scripts, as a zip or into `basis-verify/` in the product's folder (the linked repo by default). The agent that implements the feature runs `capture.mjs` to photograph the design and its implementation on the same machine with the same settings, and `compare.mjs` to compare them pixel for pixel, aiming at 0% difference. Parts allowed to differ are named exceptions in `exceptions.json`, each with a reason: a region of the image, or elements by CSS selector. Views show images (photos, avatars, illustrations) as placeholders of their own in `views/assets/`, marked `data-basis-media`; the kit leaves those elements out of the comparison on both sides but still fails a shot whose image is missing, moved or resized, so the product's real photos pass when they fill the same boxes. A screen that loads images from another site is reported when the kit is built. Basis takes the screenshots with Playwright's Chromium when it is installed (`npx playwright install chromium`), otherwise with Chrome or Edge; each screen is captured twice, and screens that render differently each time are reported, since nothing can match them.
- **A prompt for the implementing agent:** the verification kit also tells the coding agent that builds the views in the product what to build and how to check it. `PROMPT.md` states the goal, where everything in the kit is, each view with its screens, and the loop: capture the design and the product, compare, read the diff images, fix and repeat, with the rules for images, exceptions and when to stop and report. Each view gets notes in `views/<view>.md`, written from its source without an agent turn: its screens and their shots, which screen each button leads to (from the view's `go()` calls), the components, patterns and data it uses, and the design's tokens it reads with their values. The source of the views and of what they use is in `source/`. After a build, **Copy prompt** puts a few lines on the clipboard that point the agent at `basis-verify/PROMPT.md` and name the view to build (pick one, or all). The kit carries the same loop as a Claude Code skill (`SKILL.md`), which writing into the product's folder can install as `.claude/skills/basis-verify/SKILL.md`; Basis replaces that file later only while it still carries Basis' marker. The kit's README has the same instructions as a paragraph for `AGENTS.md`.

## Privacy

Basis runs on your machine and answers only on localhost. It sends no telemetry. What leaves your machine is what the agent sends to Anthropic or OpenAI under your own account (your prompts, attachments, the files it reads, including a linked product repo, and the screenshots it takes of the design), web fonts that your design system imports from Google Fonts or Bunny Fonts, and the Codex adapter that npx downloads on first use.

## Troubleshooting

- **"Basis needs git on the PATH":** install git, then start Basis again.
- **"Port 5320 is in use":** another Basis is probably running. Stop it, or start this one with another `PORT`. The preview takes `PORT + 1` (further open projects take free ports).
- **The agent asks you to log in:** run `claude` (or `codex login`) in a terminal, then pick the agent again in the picker.
- **"Usage limit":** your plan's limit is reached. It resets after a while, and the conversation is kept until then.
- **"Another Claude Code process is refreshing it":** several Claude Code processes refreshed their login at once. Send the message again.
- **"A newer version of Basis has opened this project":** update Basis. An older Basis refuses such a project rather than misreading it.

## Stack

React 19 + Vite with CSS Modules and plain CSS custom properties. The server is plain Node (`server/`). It acts as an ACP client via `@agentclientprotocol/sdk` and runs two Vite instances in middleware mode, one for the app and one for the sandboxed preview. Basis always runs through Vite, because the preview compiles workspace code live.

```bash
npm run check
```

`npm run check` runs the type check, oxlint, Prettier and the tests. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the architecture, how to work on Basis, the gotchas and where the work stands.

## License

Basis is licensed under the [Apache License 2.0](LICENSE). The starter components, patterns and views in `template/` are licensed under [MIT-0](template/LICENSE): what you build from them and export is yours, with no attribution required.
