# Security

## Reporting a vulnerability

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Do not open a public issue for it.

Please include what an attacker can do, the steps to reproduce it, and the Basis version (`npm view basis-design version` for the latest, or the `version` in `package.json` of your checkout).

## Supported versions

Fixes go into the latest release on npm. Basis is at 0.x, so there are no older branches that get fixes.

## What Basis protects

Basis runs on your own machine and answers only on localhost. The points below are its security boundaries, so a way past one of them is a vulnerability:

- The server answers only requests for `localhost` or `127.0.0.1` on its own ports, and only the Basis page may use its WebSocket.
- The gallery runs agent-written code in a sandboxed iframe on its own origin, which cannot reach the Basis page or its WebSocket.
- Basis approves the agent's reads inside the workspace (and a linked product repo) and its edits to the design files without asking. Every other file, shell command and web fetch waits for your approval. Paths are compared after following links.
- The agent starts in the mode that asks, and Claude Code runs without your own `~/.claude` settings.

What the agent does with a command you approved is up to the agent and you. Text in a linked product repo can steer the agent like any prompt.
