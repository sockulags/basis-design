# Basis

Prompt a complete design system into existence, then refine it down to the last transition.

Basis is a local web app with two halves. On the left you talk to a coding agent, either Claude Code or Codex. On the right is a live specimen of your design system: colour roles with contrast checks, type, spacing, shape, motion, and every component in every state (default, hover, pressed, focus, disabled, loading, invalid, checked, indeterminate…). Start broad ("warm editorial, serif headings") and go as deep as you like ("softer button press", "make the tab indicator slide").

The agent owns both the tokens and the component source, so the result is a real starting point for a project rather than a theme.

The agent runs over the [Agent Client Protocol](https://agentclientprotocol.com) on your machine, using the CLI login you already have. You need no API keys, and usage runs on your own Claude or ChatGPT subscription.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5320. Basis starts Claude Code by default; switch to Codex from the picker above the chat. Basis needs `git` on the PATH.

- **Claude Code:** log in once with `claude` in a terminal. Basis starts it through `@agentclientprotocol/claude-agent-acp`.
- **Codex:** log in once with `codex login`. Basis starts it through `npx @zed-industries/codex-acp`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASIS_HOME` | the Basis folder | Where the project list (`basis.projects.json`) and new projects (`workspaces/`) live |
| `BASIS_WORKSPACE` | | Opens just this workspace for one run, without touching the project list (for tests and one-off use) |
| `BASIS_AGENT` | `claude` | Agent started on boot (`claude` or `codex`) |
| `PORT` | `5320` | Port of the Basis app (bound to 127.0.0.1 only) |
| `BASIS_PREVIEW_PORT` | `PORT + 1` | Port of the sandboxed preview origin |

## Projects

Each project is a workspace of its own: its own design system, history, chat and review. Switch, create and open projects from the menu with the project's name at the top left.

A project can link the **product repo** it designs for (project menu, **Link product repo…**). The agent reads and searches it without asking, to match the product's look, components and terms, and never writes there: writes outside the workspace are refused. **New project…** can also start from a product repo: the project takes the repo folder's name unless you give one, links the repo and starts by bringing in its design. **Bring in its design** (offered when you link, and in the project menu) starts a guided turn: the agent maps the repo's tokens onto `design-system.json`, restyles the components and patterns to resemble the product's, writes what it learned to `product.md` (where the tokens live, an inventory of the product's components and their Basis counterparts, terms to reuse) and opens a review.

- **New project** starts from Basis' defaults, or as a copy of the open project's tokens and components (not its history). It lives in `workspaces/` in the Basis folder.
- **Open folder** adds a workspace from anywhere, or an empty or new folder for Basis to set up, inside a product repo for instance. Basis refuses a folder that already has other files, so it never starts a history in someone's project.
- Switching waits while the agent works. The agent of the project you leave stops, and coming back resumes its conversation, so it remembers where you were. The export remembers its target folder per project.
- Removing a project from the list never deletes its folder. The `./workspace` of earlier Basis versions becomes the first project.

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

`patterns/` holds composed components such as Navbar, SidebarNav, PageHeader, DataTable with Pagination, StatCard, FormSection, EmptyState and AppShell. They import only from `../components`, have their own specimens, and appear on the gallery's **Patterns** page, which you switch to in the top bar. The agent edits and extends them like everything else, so a token or base-component change flows through to every pattern. **Show at** above the specimens renders every block at mobile, tablet or desktop width and in both themes at once. Each copy is a size container, so patterns respond with `@container` rules to the width they are shown at.

`shared/contracts.ts` (copied to `.basis/contracts.ts`) is the baseline API every design system keeps. A component can change completely and gain props or variants, but it must keep its export and accept the contract's props. Components the design system adds get their contract in `components/contracts.ts`, which the agent writes when it creates them; every export of `components/index.ts` needs a contract in one of the two files. Patterns work the same way: `shared/pattern-contracts.ts` (copied to `.basis/pattern-contracts.ts`) is the baseline for the starter patterns, and `patterns/contracts.ts` holds the contracts of patterns the design system adds.

`views/` holds **views**: whole screens of a product's flows, built only from the components and patterns, on the gallery's **Views** page. A view is a specimen with a `flow` block: its screens show one at a time with a strip to jump between them, and buttons in a screen move through the flow (a row opens its detail, Save goes back). Views fill with realistic made-up data, and they are left out of the export: they prototype a product, they are not part of the design system.

**New component** and **New pattern** at the bottom of the sidebar ask for a name and what it is for, then start a guided agent turn: it checks for an existing component with the same job, creates the source, contract (for base components), export and specimen, and the result appears in the gallery. You can ask for the same thing in the chat.

## How it works

- **Live preview:** the gallery runs on its own origin (`BASIS_PREVIEW_PORT`) in a sandboxed iframe, because it executes code the agent writes. That code cannot reach the bridge to the agent or the Basis UI. Vite compiles `components/` on the fly, so saved edits hot-reload in place, and token changes arrive over `postMessage`.
- **Problems loop:** after every turn Basis validates the tokens, type-checks `components/` and `patterns/`, checks the components against their contracts, and collects render errors and malformed specimens from the preview. A broken section shows its error instead of taking down the gallery. Anything wrong is sent back to the agent automatically, at most twice per turn, and is listed above the composer.
  - **Accessibility checks** run alongside: the colour roles are checked for WCAG 2 AA contrast in both themes, and axe-core checks the live demos (gallery sections and the review's live side) for serious and critical WCAG A and AA violations once the preview settles. Findings are listed apart above the composer, with a button to ask the agent to fix them. The agent hears only about findings its own change introduced, so an existing one does not send it off on every turn, and a colour you asked for on purpose is kept.
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
- **Permissions:** reads inside the workspace and edits to the files the agent may change are approved automatically. Anything else, such as shell commands, web fetches or other files, shows up in the chat for you to approve.
- **Export:** the **Starter kit** tab packages the whole design system for a new project. You can download it as a zip or write it straight into a project folder; if any file there would change, nothing is written until you confirm. The kit contains:
  - `components/`, with imports rewritten to extensionless form so any bundler and default `tsconfig` accept them,
  - `tokens.css`, CSS custom properties with dark mode via `data-theme` or the OS setting,
  - `theme.tailwind.css`, a Tailwind v4 entry stylesheet,
  - `design-system.json`,
  - a README on wiring it up.

  The kit needs React 18+ and CSS Modules, nothing else. The other tabs export the token formats one at a time.

## Stack

React 19 + Vite with CSS Modules and plain CSS custom properties. The server is plain Node (`server/`). It acts as an ACP client via `@agentclientprotocol/sdk` and runs two Vite instances in middleware mode, one for the app and one for the sandboxed preview. Basis always runs through Vite, because the preview compiles workspace code live.

```bash
npm run check
```

`npm run check` runs the type check, oxlint, Prettier and the tests. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the architecture, how to work on Basis, the gotchas and where the work stands.
