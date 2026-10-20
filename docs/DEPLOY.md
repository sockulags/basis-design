# Running Basis as a service

On your own machine, `npx basis-design` is all it takes. This page is for running Basis for a team, or as a step
of a pipeline such as The Factory: in a container, reachable from other machines, behind a token.

## What runs

One container with Basis, git, Playwright's Chromium (for the gallery's checks, the agent's screenshots and the
verification kit) and Claude Code (the agent). It keeps two volumes:

- `/data`: the projects (`BASIS_HOME`): their workspaces, history, chats and the project list.
- `/home/node`: Claude Code's login, and the agents' caches.

It publishes port 5320 (the app and the API) and 5321 to 5324 (the previews of up to four open projects). A
preview is opened at the same host name as the app on its own port, so publish them under the same numbers. A
Basis started with `npm run dev` or `npx basis-design` on the same machine uses 5320 and 5321 too: stop it first.

## Start it with Docker Compose

1. Copy `.env.example` to `.env` and fill it in:
   - `BASIS_ACCESS_TOKEN`: the secret people give once per browser. Required: Basis listens beyond loopback, and
     its agent runs commands.
   - `BASIS_API_TOKEN`: the secret pipelines send to the API. Leave it empty to keep the API off.
   - `BASIS_HOSTS`: the host names people open Basis at, besides `localhost` (`basis.internal`, an IP address).
     Basis refuses pages asked for by any other name.

2. Build and start it:

   ```bash
   docker compose up -d --build
   ```

3. Log Claude Code in, once. The login stays in the `/home/node` volume:

   ```bash
   docker compose exec basis claude
   ```

   Run `/login` there, follow the link, then leave with `/exit`.

4. Open `http://localhost:5320` (or the host in `BASIS_HOSTS`), give the access token, and Basis opens. Its first
   project starts from Basis' defaults.

5. With the API on, check it from the machine that will use it:

   ```bash
   curl -H "Authorization: Bearer $BASIS_API_TOKEN" http://localhost:5320/v1/projects
   ```

## Design for a product repo

A project designs best with its product's repo linked: the agent reads its pages, tokens and terms. Mount the
repos read-only (uncomment `./repos:/repos:ro` in `compose.yaml`, with the repos cloned in `./repos`), then link
`/repos/<name>` from the project menu (**Link product repo…**). Basis never writes there.

## Use it from a pipeline

The API under `/v1` (README, "The API") lets a pipeline start a view for an issue, follow it, and fetch its
verification kit. For The Factory, a plugin does that from a workflow step: see
[integrations/the-factory/README.md](../integrations/the-factory/README.md). Its server and runner reach Basis by
the service's name on their network (`http://basis:5320`); the API needs no entry in `BASIS_HOSTS`, since it is
protected by its token.

To put Basis on The Factory's Compose network, add it to the same project, or join theirs:

```yaml
services:
  basis:
    networks: [default, factory]
networks:
  factory:
    external: true
    name: <the factory's network, see `docker network ls`>
```

## Kubernetes

Run one replica (projects and their agents live in one process) with two persistent volumes, `/data` and
`/home/node`, and the three secrets from `.env` as environment variables. Expose ports 5320 to 5324 on the
internal network: a Service of type LoadBalancer on the VPN, or `kubectl port-forward` for one person. Log Claude
Code in with `kubectl exec -it <pod> -- claude`. An ingress that routes by host name alone cannot reach the
previews yet, since each is a port of its own.

## Update, back up

- Update: pull this repo and `docker compose up -d --build`. The volumes stay.
- Back up the `basis-data` volume: each project is a git repository, so its history comes along.
- Projects close after ten minutes without a viewer or work, and open again when asked for, by the API too.
