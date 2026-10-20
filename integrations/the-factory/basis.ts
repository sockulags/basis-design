import { z } from "zod";

/*
 * The Factory plugin for Basis: a card's screens are designed in Basis, and the verification kit lands on the
 * card's branch for the implementing step. Copy this file into the-factory's packages/core/src/plugins/ and add
 * basisPlugin() to builtinPlugins(); README.md beside it says how to configure and use it.
 *
 *   design.start_view  (enter hook)  asks Basis for a view for the card's issue, unless it has one already,
 *                                    and links the card to Basis
 *   design.fetch_kit   (exit hook)   writes the view's verification kit into the card's worktree
 *                                    (basis-verify/<card key in lowercase>/) and commits it
 *
 * Only zod is imported, so the file builds in either repo; the types below are the parts of the Factory's own
 * plugin types it uses, and match them structurally.
 */

const Config = z.object({
  /** Basis as the Factory's server and runner reach it, e.g. http://basis:5320. */
  url: z.url(),
  /** Basis as people open it, for the link on the card; `url` when absent. */
  appUrl: z.url().optional(),
  /** The Basis project that designs for this product: its id or its name. */
  project: z.string().min(1),
  /** The env var holding Basis' BASIS_API_TOKEN, on the Factory's server and on its runner. */
  tokenEnv: z.string().min(1).default("BASIS_API_TOKEN"),
  /** Where the kit goes in the repo; Basis' default, basis-verify/<view id>, when absent. */
  folder: z.string().optional(),
});
export type BasisConfig = z.infer<typeof Config>;

/** What the hooks use of a Factory hook's context. */
export interface BasisHookContext {
  card: { id: string; key: string; title: string; body: string; worktreePath: string | null };
  board: {
    addLink(input: {
      cardId: string;
      plugin: string;
      kind: string;
      ref: string;
      url: string;
      title?: string | null;
    }): Promise<unknown>;
  };
  runner: {
    exec(command: string, cwd: string, timeoutMs?: number): Promise<{ exitCode: number; output: string }>;
    commitAll(cwd: string, message: string): Promise<string | null>;
  };
  config: BasisConfig;
  env: NodeJS.ProcessEnv;
}

/** A view as Basis' API answers it. */
interface BasisView {
  id: string;
  title: string;
  screens: { id: string; label: string }[];
  agent: "working" | "waiting" | "idle";
}

/** The id Basis gives the view for an issue: WEB-12 gives web-12 (shared/issue.ts in Basis). */
export function viewIdFor(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function basisPlugin(deps: { fetch?: typeof fetch } = {}) {
  const doFetch = deps.fetch ?? fetch;

  const api = (config: BasisConfig, env: NodeJS.ProcessEnv) => {
    const token = env[config.tokenEnv];
    if (!token) throw new Error(`Basis: environment variable ${config.tokenEnv} is not set on the server`);
    const base = `${config.url.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(config.project)}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    return {
      /** The view, or null while Basis has none by that id; `agent` says whether Basis' agent still works. */
      async view(id: string): Promise<{ view: BasisView | null; agent: string }> {
        const res = await doFetch(`${base}/views/${encodeURIComponent(id)}`, { headers });
        const body = (await res.json().catch(() => ({}))) as Partial<BasisView> & { error?: string };
        if (res.status === 404 && body.agent) return { view: null, agent: body.agent };
        if (!res.ok) throw new Error(`Basis: HTTP ${res.status} for the view ${id}: ${body.error ?? ""}`);
        return { view: body as BasisView, agent: body.agent ?? "idle" };
      },
      async startView(card: BasisHookContext["card"]): Promise<{ view: string; thread: string }> {
        const res = await doFetch(`${base}/views`, {
          method: "POST",
          headers,
          body: JSON.stringify({ issue: card.key, title: card.title, description: card.body }),
        });
        const body = (await res.json().catch(() => ({}))) as { view?: string; thread?: string; error?: string };
        if (res.status !== 202 || !body.view)
          throw new Error(`Basis: could not start the view (HTTP ${res.status}: ${body.error ?? ""})`);
        return { view: body.view, thread: body.thread ?? "" };
      },
      kitUrl: `${base}/kit`,
    };
  };

  return {
    id: "basis",
    name: "Basis",
    description:
      "Designs a card's screens in Basis and brings their verification kit to the card's branch (hooks: design.start_view, design.fetch_kit).",
    config: Config,
    exampleConfig: { url: "http://basis:5320", appUrl: "http://basis.internal:5320", project: "Auth-service" },
    hooks: {
      "design.start_view": async ({ card, board, config, env }: BasisHookContext) => {
        const basis = api(config, env);
        const id = viewIdFor(card.key);
        // Entered again (changes requested): the view is there, and the designer goes on in Basis.
        const existing = await basis.view(id);
        const started = existing.view ? null : await basis.startView(card);
        await board.addLink({
          cardId: card.id,
          plugin: "basis",
          kind: "design",
          ref: id,
          url: config.appUrl ?? config.url,
          title: `${card.key} in Basis`,
        });
        return { view: id, started: started !== null, thread: started?.thread ?? null };
      },
      "design.fetch_kit": async ({ card, runner, config, env }: BasisHookContext) => {
        if (!card.worktreePath) throw new Error("Basis: the card has no worktree to write the kit into");
        const id = viewIdFor(card.key);
        const basis = api(config, env);
        const { view, agent } = await basis.view(id);
        if (!view) throw new Error(`Basis has no view ${id} yet; its agent is ${agent}.`);
        if (agent !== "idle") throw new Error(`Basis' agent is ${agent} on ${id}; approve when it is done.`);
        // The runner may be another machine than this server, so it fetches the kit itself.
        const body = JSON.stringify({ issue: card.key, ...(config.folder ? { folder: config.folder } : {}) });
        const result = await runner.exec(
          kitCommand(basis.kitUrl, body, config.tokenEnv),
          card.worktreePath,
          10 * 60_000,
        );
        if (result.exitCode !== 0) throw new Error(`Basis: writing the kit failed: ${result.output.slice(-1000)}`);
        const folder = /into (\S+)\//.exec(result.output)?.[1] ?? null;
        const commit = await runner.commitAll(card.worktreePath, `${card.key} Design: verification kit from Basis`);
        return { view: id, screens: view.screens.length, folder, commit };
      },
    },
    instructions: () =>
      "Screens designed for this card in Basis arrive as a verification kit in basis-verify/<the card key in lowercase>/ on this branch. When it is there and you build those screens, read its PROMPT.md first and work in the loop it describes until the shots match.",
  };
}

/**
 * The shell command that writes the kit into the worktree it runs in: a Node script (Node runs the runner, so it
 * is there; curl and unzip may not be), passed as base64 so neither sh nor cmd changes it. It reads the token from
 * the runner's environment, so the token is never part of the command.
 */
export function kitCommand(url: string, body: string, tokenEnv: string): string {
  const script = KIT_SCRIPT.replace("__URL__", JSON.stringify(url))
    .replace("__BODY__", JSON.stringify(body))
    .replace("__TOKEN_ENV__", JSON.stringify(tokenEnv));
  return `node -e "eval(Buffer.from('${Buffer.from(script).toString("base64")}','base64').toString())"`;
}

/**
 * Fetches the kit as a zip and unpacks it: every file must lie in the folder Basis names in X-Basis-Kit-Folder,
 * and what the kit holds replaces the same entries there, so the project's targets.json, exceptions.json and
 * captures stay. Stored and deflated entries, the two kinds Basis writes.
 */
const KIT_SCRIPT = `
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
(async () => {
  const tokenEnv = __TOKEN_ENV__;
  const token = process.env[tokenEnv];
  if (!token) throw new Error(tokenEnv + " is not set on the runner");
  const res = await fetch(__URL__, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: __BODY__,
  });
  if (!res.ok) throw new Error("Basis answered HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  const folder = res.headers.get("x-basis-kit-folder") || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/.test(folder)) throw new Error("Basis named no kit folder");
  const zip = Buffer.from(await res.arrayBuffer());
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Basis' answer is not a zip");
  const files = [];
  for (let i = 0, at = zip.readUInt32LE(end + 16); i < zip.readUInt16LE(end + 10); i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("the zip is damaged");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    const parts = name.split("/");
    if (!name.startsWith(folder + "/") || parts.some((part) => part === ".." || part === "." || part === "") || name.includes("\\\\"))
      throw new Error("the kit holds a file outside " + folder + "/: " + name);
    if (method !== 0 && method !== 8) throw new Error("the zip uses a compression this script cannot read");
    files.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });
  }
  const tops = new Set(files.map((file) => file.name.slice(folder.length + 1).split("/")[0]));
  for (const top of tops) rmSync(path.join(folder, top), { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(path.dirname(file.name), { recursive: true });
    writeFileSync(file.name, file.data);
  }
  console.log("Wrote " + files.length + " files into " + folder + "/");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
`;
