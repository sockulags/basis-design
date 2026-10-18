# Roadmap: product repos, views and quality checks

The plan a `/loop` works through, one step per round. Each round picks the first unchecked step, builds it,
verifies it, ticks it here, and commits and pushes. Decisions made along the way go in the log at the end, so
the next round (and Lucas) can see why.

## Goal

Basis becomes a quick way into design and prototyping for the products Lucas works on: link a product repo,
let the agent bring in its design system, and build views of a feature from the patterns, with checks that
keep quality up while the agent works alone.

## Decisions from Lucas (2026-10-18)

- **Linking:** a project points at a product repo. The agent may read it, never write to it; the Basis
  workspace stays in its own folder under `BASIS_HOME`. Syncing changes forward into the repo is a later,
  separate step and not part of this plan.
- **Bringing in the design system:** tokens go into `design-system.json`, and the components and patterns are
  restyled to resemble the repo's. An inventory of the repo's own components is kept as reference for the agent.
- **Views:** a **New view** button, like New component: describe the feature or paste the ticket text. The
  agent builds the screens from the workspace's patterns with realistic made-up data, linked into a clickable
  flow.
- **Quality checks** in the fix loop are a given.
- **Autonomy:** commit and push each verified step, and make the decisions yourself while the app is early.
  Polish comes later.

## How each round works

1. Read this file and `docs/DEVELOPMENT.md`; take the first unchecked step.
2. Build it with narrow diffs that match the surrounding code. Add tests for server and parsing logic.
3. `npx prettier --write src server test shared template` and `npm run check` must pass.
4. Verify in the browser on a throwaway instance, never on Lucas' workspace or project list:
   `PORT=5330 BASIS_WORKSPACE="$TEMP/basis-test-ws" npx tsx server/index.ts`, or
   `PORT=5330 BASIS_HOME="$TEMP/basis-test-home" npx tsx server/index.ts` for anything about projects. Use a
   real agent turn when the step changes what the agent does. For a product repo, use a small fixture repo
   under `$TEMP` (Tailwind config, CSS variables and a few components), never one of Lucas' real repos.
5. Update README and `docs/DEVELOPMENT.md` where the step changes behaviour or architecture.
6. Tick the step, add decisions to the log, then commit (message explains why, body lists the changes, no AI
   attribution) and push. Stop the test instance.
7. If a step turns out bigger than one round, split it here into smaller steps first and do the first one.

Stop the loop when every step is ticked, or when something needs Lucas: a decision that would change the
product's direction, data that could be lost, or a failure you cannot get past.

## Steps

### Quality checks

- [x] **Contrast check.** Validate the colour roles pairwise in both themes (text on its surfaces, text on
      primary and the other filled roles, borders where they carry meaning) against WCAG AA, as problems in the
      fix loop phrased so the agent can act. Pure function in `shared/`, with tests; report from the server
      with the other design problems.
- [x] **Accessibility check of the live gallery.** Run axe-core in the preview on the sections the user sees
      (live side only, never past versions), report serious and critical violations as problems with the
      section and selector. Keep it cheap: run after renders settle, not on every update.
- [x] **Contracts for patterns.** The starter patterns get a baseline contract like `shared/contracts.ts`;
      patterns the agent adds get theirs in `patterns/contracts.ts`. Type-checked like components, and the
      template must satisfy them (`template/contract-check.ts`).

### Product repos

- [x] **Link a repo to a project.** A project entry can name a product repo folder (project menu: link,
      change, unlink). Reads and searches inside the repo are approved automatically; writes there are
      refused like any path outside the workspace. Every turn tells the agent the repo exists and is
      read-only.
- [x] **Bring in its design system.** A guided turn, started from the project menu after linking (and offered
      right after): the agent surveys the repo (Tailwind config, CSS variables, theme files, component
      library), writes the tokens, restyles components and patterns to match, writes a component inventory
      to a new agent-editable file (`product.md`) and opens a review of the key specimens.
- [ ] **Create a project from a repo.** The create dialog can start from a product repo: it links the repo and
      runs the step above in one go.
- [ ] **Repo context in every turn.** The brief and per-turn context point the agent at `product.md` and the
      repo, so requests about the product's features use its real terms and structure.

### Views

- [ ] **Views page.** A third page, `views/`, for whole screens. A view file defines a flow of screens; each
      screen renders full width and gets a `go(screenId)` prop so buttons and links move through the flow. The
      gallery shows one screen at a time with a strip to jump between them, and Show at widths apply. Starter
      template: one small example view built from the starter patterns. Views are not part of the export.
- [ ] **New view.** A sidebar button on the Views page asks for a name and the feature (or ticket text) and
      starts a guided turn: the agent builds the flow from the workspace's patterns with realistic made-up
      data, consistent across screens, and opens a review of it.
- [ ] **Views in reviews.** Review targets can show a view's screens, with alternatives and blink working as
      for specimens.

### Later (not in this loop)

- Syncing tokens and components forward into the linked repo.
- Visual comparison of the whole gallery between two history entries.

## Decision log

- 2026-10-18: Contrast runs in the preview on browser-resolved colours rather than on the server, so oklch,
  color-mix and var() references work. Findings travel as their own `checks` channel, do not block Approve,
  and reach the agent only when its turn introduced them (once; a fix-up turn starts from them). Borders are
  not checked, since most systems draw them below 3:1 on purpose; `textSubtle` is held to 3:1.
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
