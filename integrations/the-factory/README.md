# Basis in The Factory

A plugin for [The Factory](https://github.com/sockulags/the-factory) that makes Basis a step of a card's workflow:
the card's screens are designed in Basis, a person reviews them there, and their verification kit lands on the
card's branch, where the implementing agent builds the screens until they match the design pixel for pixel.

It lives in this repo because it is about Basis' API; The Factory gets a copy. The file imports only `zod`, which
both repos have, and declares the parts of The Factory's plugin types it uses.

## What happens

1. A card enters the design step. The enter hook `design.start_view` calls `POST /v1/projects/:project/views` with
   the card's key, title and body. Basis' agent builds a view named for the card (`WEB-12` gives the view
   `web-12`, titled `WEB-12 …`) and opens it in a review. The card gets a link to Basis.
2. The step's own agent writes a short handover from the spec (which screens and states the design must cover),
   and the gate waits for a person.
3. The designer reviews and refines the view in Basis, approves its review there, then approves the step in The
   Factory. "Changes requested" with a comment enters the step again, and the enter hook sends the comment to
   Basis (`POST …/views/web-12/messages`), where the agent changes the view in a turn of its own and opens it in a
   review. A comment is sent once, also when the step is retried.
4. The exit hook `design.fetch_kit` checks that the view exists, Basis' agent is done and the view's review in
   Basis is approved, has the runner fetch the kit into `basis-verify/web-12/` in the card's worktree, and commits
   it (`WEB-12 Design: verification kit from Basis`). Files of the project's own there (`targets.json`,
   `exceptions.json`, `actual/`) stay.
5. The plugin's instruction, added to every step's first prompt, tells the agents that build screens to read the
   kit's `PROMPT.md` and work in its capture and compare loop until the shots match.

The runner fetches the kit itself, because it may be another machine than The Factory's server. It runs a small
Node script (Node runs the runner; `curl` and `unzip` are not in its image) that reads the token from the runner's
environment, so the token is never part of a command or the card's history.

## Install

1. Copy `basis.ts` to The Factory's `packages/core/src/plugins/basis.ts`.
2. Register it in `builtinPlugins()` in `packages/core/src/plugins/index.ts`:

   ```ts
   import { basisPlugin } from "./basis.js";
   // ...
   return [githubPlugin(deps), gitlabPlugin(deps), mcpPlugin(), instructionsPlugin(), webhookPlugin(deps), basisPlugin(deps)];
   ```

3. Give both the Factory's server and its runner the API token, under the name the config gives
   (`BASIS_API_TOKEN` by default): in `deploy/.env`, or the Kubernetes secret both workloads read.
4. Enable it for the product under *Products & repos → Integrations*:

   ```json
   {
     "url": "http://basis:5320",
     "appUrl": "http://basis.internal:5320",
     "project": "Auth-service"
   }
   ```

   | Key | Meaning |
   | --- | --- |
   | `url` | Basis as the Factory's server and runner reach it |
   | `appUrl` | Basis as people open it, for the link on the card (`url` when absent) |
   | `project` | The Basis project that designs for this product, by id or name |
   | `tokenEnv` | The env var with Basis' `BASIS_API_TOKEN`, on the server and the runner (default `BASIS_API_TOKEN`) |
   | `folder` | Where the kit goes in the repo (default `basis-verify/<view id>`) |
   | `requireApproval` | Wait for the view's review to be approved in Basis before taking the kit (default `true`) |

5. Add the design step to a workflow, after the spec. `workflow.example.yaml` here is the shipped feature
   workflow with it, and `prompts/screens.md` its prompt:

   ```yaml
   screens:
     agent: claude
     mode: consult
     prompt: prompts/screens.md
     gate: human
     hooks:
       enter: [design.start_view]
       exit: [design.fetch_kit]
   ```

Basis needs its API on (`BASIS_API_TOKEN`) and the project linked to the product's repo, so its agent reads the
product's own pages and terms while it designs. See [docs/DEPLOY.md](../../docs/DEPLOY.md) for running Basis
next to The Factory.

## When something goes wrong

A hook that throws blocks the card with the reason, and Retry runs the step again.

- *Basis has no view web-12 yet; its agent is working*: the gate was approved before Basis was done. Wait for
  the view in Basis, then approve again.
- *WEB-12 is still in review in Basis*: approve (or discard) the review in Basis first.
- *BASIS_API_TOKEN is not set on the server* or *on the runner*: give both workloads the secret.
- *Basis answered HTTP 401*: the token differs from Basis' `BASIS_API_TOKEN`.
- *the kit holds a file outside basis-verify/web-12/*: the zip did not come from Basis as expected; nothing was
  written.
