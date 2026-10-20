# Basis for coding agents

Use Basis from any repo and any coding agent: build with the product's design system, have an issue's screens
designed in Basis, bring their verification kit into the repo, and prove the result with basis-diff, Basis' own
check that the agent cannot change.

It needs a Basis to talk to: one on your machine (`npx basis-design`), or your team's (see
[docs/DEPLOY.md](../../docs/DEPLOY.md)).

## What is in it

- **An MCP server** (`mcp/basis-mcp.mjs`, no dependencies) with the tools `basis_projects`,
  `basis_design_system`, `basis_views`, `basis_design_view`, `basis_view_status`, `basis_request_changes`,
  `basis_fetch_kit` and `basis_verify`.
- **Skills** that say when and how to use them:
  - `basis-design`: have an issue's screens designed in Basis, follow it, ask for changes, fetch the kit.
  - `basis-verify`: build the screens from the kit in `basis-verify/` until every shot matches.
  - `basis-tokens`: build UI with the product's tokens and components instead of guessing values.
  - `basis-diff`: prove the result with Basis' own photographs, kept out of the agent's reach.

## Claude Code

```bash
claude plugin marketplace add sockulags/basis-design
```

```bash
claude plugin install basis@basis-design
```

Or in a session: `/plugin install basis --marketplace sockulags/basis-design`. Installing in a session asks for
the settings; with the commands above, set them with `/plugin configure basis`. Leave them empty for a Basis on
your machine:

| Setting | Meaning |
| --- | --- |
| Basis URL | Where Basis answers (`http://localhost:5320` when empty) |
| Basis API token | Basis' `BASIS_API_TOKEN`; when empty, the token a Basis on your machine keeps in `~/.basis/api-token` |
| Basis project | The project that designs for this repo, when Basis has several |

The skills are then `/basis:basis-design` and so on, and Claude also uses them by itself when a task fits.

## Codex and other agents

Every agent that speaks MCP can run the server. For Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.basis]
command = "node"
args = ["/path/to/basis-design/plugins/basis/mcp/basis-mcp.mjs"]
env = { BASIS_URL = "http://localhost:5320" }
```

Add `BASIS_API_TOKEN` (and `BASIS_PROJECT`) to `env` for a Basis elsewhere. The skills are plain `SKILL.md` files:
copy the folders in `skills/` where the agent reads skills (`~/.agents/skills/` for Codex), or paste their text
into the repo's `AGENTS.md`.
