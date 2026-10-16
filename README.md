# Basis

Prompt a complete design system into existence, then refine it down to the last transition.

Basis is a local web app with two halves. On the left you talk to a coding agent, either Claude Code or Codex. On the right is a live specimen of your design system: colour roles with contrast checks, type, spacing, shape, motion, and every component in every state (default, hover, pressed, focus, disabled, loading, invalid, checked, indeterminate…). Start broad ("warm editorial, serif headings") and go as deep as you like ("softer button press", "slower dialog entrance").

The agent runs over the [Agent Client Protocol](https://agentclientprotocol.com) on your machine, using the CLI login you already have. You need no API keys, and usage runs on your own Claude or ChatGPT subscription.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5320. Basis starts Claude Code by default; switch to Codex from the picker above the chat.

- **Claude Code:** log in once with `claude` in a terminal. Basis starts it through `@agentclientprotocol/claude-agent-acp`.
- **Codex:** log in once with `codex login`. Basis starts it through `npx @zed-industries/codex-acp`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASIS_WORKSPACE` | `./workspace` | Folder holding `design-system.json` and its history |
| `BASIS_AGENT` | `claude` | Agent started on boot (`claude` or `codex`) |
| `PORT` | `5320` | Server port (bound to 127.0.0.1 only) |

## How it works

- `design-system.json` in the workspace is the single source of truth. The agent edits it; Basis watches it, validates it against the schema in `shared/design.ts` and pushes valid versions to the preview over a WebSocket.
- If an edit breaks validation, the preview keeps the last valid version, and Basis automatically sends the errors back to the agent, at most twice per turn.
- The composer takes more than text. Paste, drop or attach images (sent as ACP image blocks when the agent supports them), or press **Pick** and click components in the preview. Each pick is attached as a numbered annotation carrying its variant, state, theme, driving tokens and computed styles, so "make [1] softer" is unambiguous. Pick mode stays on until Done or Esc: click as many components as you like, click one again to remove it. Numbered markers stay on the picked components until you send.
- Every agent turn becomes one history entry, labelled with its prompt and the tokens it changed. Click any entry to inspect that version in the preview without touching the file. A banner then lists every token that differs from now, and you can step through versions or restore one. Undo walks back through the steps instead of toggling between two of them.
- The chat can be resized by dragging its edge (double-click resets) and hidden with the toggle in the top bar or Ctrl+B.
- The agent's instructions are written into the workspace as `AGENTS.md` and `CLAUDE.md`, and are also sent as an appended system prompt when the agent supports it.
- Edits and reads inside the workspace are approved automatically. Anything else, such as shell commands, web fetches or files outside the workspace, shows up in the chat for you to approve.
- Export gives you `tokens.css` (CSS custom properties, with dark mode via `data-theme` or the OS setting), a Tailwind v4 `@theme` stylesheet, or the raw JSON.

## Stack

React 19 + Vite with CSS Modules and plain CSS custom properties. The preview components read only the generated variables, so what you see is exactly what the export contains. The server is plain Node (`server/`), acting as an ACP client via `@agentclientprotocol/sdk` and serving Vite in middleware mode during development.

```bash
npm run typecheck
npm run build && npm start   # production build served by the same server
```
