# Contributing to Basis

Bug reports, ideas and pull requests are welcome.

## Reporting a bug

Open an issue with what you did, what you expected and what happened instead. Include your OS, your Node.js version (`node -v`), the agent you used (Claude Code or Codex), and the text of any error Basis or the terminal showed.

## Working on Basis

```bash
git clone https://github.com/sockulags/basis-design.git
cd basis-design
npm install
npm run dev
```

Basis opens at http://localhost:5320. Server changes need a restart; client code reloads by itself. To try a change without touching your own projects, start a separate instance with a throwaway workspace:

```bash
PORT=5330 BASIS_WORKSPACE=/tmp/basis-test npx tsx server/index.ts
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains how Basis is put together and lists the gotchas that cost time. Read it before a larger change.

## Before you open a pull request

```bash
npm run check
npm run test:e2e
```

`npm run check` runs the type check, oxlint, Prettier and the unit tests. `npm run test:e2e` runs the app in Chromium with a stand-in agent; run `npx playwright install chromium` once first. CI runs both.

- Keep a pull request to one change, and add a test for it. Changes to history, reviews or migrations need one, since that code restores and deletes files in people's workspaces.
- Write code, comments and commit messages in English. A commit message says why the change is needed, with a body listing the main changes.
- For a bigger feature, open an issue first and describe the user flow: what starts it, what the user does, and what ends it.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE). Contributions to `template/` are licensed under [MIT-0](template/LICENSE), like the rest of that folder.
