import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { kitFolder, viewKitFolder, type CaptureList } from "../shared/capture.ts";
import { isComponentName, pageById, toComponentName } from "../shared/frame.ts";
import { issueKey, issueViewId } from "../shared/issue.ts";
import type { ProjectEntry, VerifyKitSummary } from "../shared/protocol.ts";
import { viewInstruction } from "./brief.ts";
import type { KitFile } from "./verify.ts";

/*
 * The HTTP API for tools that use Basis as a step of their own work, such as a pipeline that has a view designed
 * for an issue and later fetches its verification kit. It lives under /v1 on the chrome's port, answers only
 * with the token in BASIS_API_TOKEN (`Authorization: Bearer <token>`), and is off without one.
 *
 *   GET  /v1/projects                         the projects
 *   GET  /v1/projects/:project/views          the project's views with their screens
 *   GET  /v1/projects/:project/views/:view    one view, and whether the project's agent is working
 *   POST /v1/projects/:project/views          { issue, title?, description?, name? }: starts the New view turn
 *   POST /v1/projects/:project/kit            { issue? | views?, folder? }: the verification kit as a zip
 *
 * A project is named by its id or its name. Answers are JSON, except the kit.
 */

export const API_PATH = "/v1";

/** What the API needs of an open project. */
export interface ApiProject {
  entry: ProjectEntry;
  busy: boolean;
  waiting: boolean;
  agent: {
    whenReady(): Promise<boolean>;
    newThread(): string;
    prompt(text: string, attachments: { instruction?: string }, options: { thread?: string }): Promise<void>;
  };
  screenshots: { list(): Promise<CaptureList> };
}

export interface ApiOptions {
  /** BASIS_API_TOKEN; the API is off without it. */
  token: string | undefined;
  projects: () => ProjectEntry[];
  /** Opens a project, or gives it when it is open. */
  open: (entry: ProjectEntry) => Promise<ApiProject>;
  /** Builds a kit, or null when one is being built already. */
  buildKit: (
    project: ApiProject,
    request: { views?: string[]; folder?: string },
  ) => Promise<{ files: KitFile[]; summary: VerifyKitSummary } | null>;
  zip: (files: KitFile[], folder: string) => Uint8Array;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 1024 * 1024;

/** Whether `header` carries the token, compared in constant time. */
function authorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "");
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new ApiError(413, "The request body is too large.");
  }
  try {
    const body: unknown = raw ? JSON.parse(raw) : {};
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Answered below.
  }
  throw new ApiError(400, "The request body must be a JSON object.");
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The views of a project, as the API lists them. */
function viewsOf(list: CaptureList) {
  return list.views.map((view) => ({
    id: view.id,
    title: view.title,
    file: view.file,
    screens: view.screens.map((screen) => ({ id: screen.id, label: screen.label })),
  }));
}

/** The file name of a new view for an issue: the name given, else the title, else the key, in PascalCase. */
export function viewName(key: string, title: string, name: string): string {
  for (const candidate of [name, title, key].map(toComponentName)) {
    const named = /^[0-9]/.test(candidate) ? `View${candidate}` : candidate;
    if (isComponentName(named)) return named;
  }
  throw new ApiError(400, "Give the view a name of letters and digits.");
}

/** Handles a request under /v1; false for any other path, which the caller answers. */
export async function handlePipelineApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ApiOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname !== API_PATH && !url.pathname.startsWith(`${API_PATH}/`)) return false;
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!options.token) {
    reply(404, { error: "The API is off. Start Basis with BASIS_API_TOKEN set to use it." });
    return true;
  }
  if (!authorized(req.headers.authorization, options.token)) {
    reply(401, { error: "Send the API token as Authorization: Bearer <token>." });
    return true;
  }
  try {
    const parts = url.pathname.slice(API_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
    const result = await route(req, res, parts, options);
    if (result !== undefined) reply(result.status ?? 200, result.body);
  } catch (error) {
    if (error instanceof ApiError) reply(error.status, { error: error.message });
    else reply(500, { error: (error as Error).message });
  }
  return true;
}

/** Answers a request, or returns the JSON answer; undefined when it wrote the answer itself (the kit). */
async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parts: string[],
  options: ApiOptions,
): Promise<{ status?: number; body: unknown } | undefined> {
  const method = req.method ?? "GET";
  if (parts[0] !== "projects") throw new ApiError(404, "No such endpoint.");
  if (parts.length === 1 && method === "GET") {
    return { body: { projects: options.projects().map(({ id, name, repo }) => ({ id, name, repo })) } };
  }
  const named = parts[1]!;
  const entry =
    options.projects().find((project) => project.id === named) ??
    options.projects().find((project) => project.name.toLowerCase() === named.toLowerCase());
  if (!entry) throw new ApiError(404, `No project ${named}.`);
  const project = await options.open(entry);
  const [, , what, id] = parts;

  if (what === "views" && parts.length === 3 && method === "GET") {
    return { body: { views: viewsOf(await project.screenshots.list()) } };
  }
  if (what === "views" && parts.length === 4 && method === "GET") {
    const view = viewsOf(await project.screenshots.list()).find((item) => item.id === id);
    const agent = project.waiting ? "waiting" : project.busy ? "working" : "idle";
    if (!view) return { status: 404, body: { error: `No view ${id} yet.`, agent } };
    return { body: { ...view, agent } };
  }
  if (what === "views" && parts.length === 3 && method === "POST") {
    const body = await readJson(req);
    const key = issueKey(text(body.issue));
    if (!key) throw new ApiError(400, "Give the issue's key, such as WEB-12 or owner/repo#42.");
    const title = text(body.title);
    const name = viewName(key, title, text(body.name));
    const purpose = [title, text(body.description)].filter(Boolean).join("\n\n").slice(0, 8000);
    if (!(await project.agent.whenReady())) throw new ApiError(503, "The project's agent could not start.");
    const { folder } = pageById("views");
    const thread = project.agent.newThread();
    // The turn runs on; the caller follows it with GET .../views/:view.
    void project.agent
      .prompt(
        `New view: ${name} (${key})${purpose ? `\n\n${purpose}` : ""}`,
        { instruction: viewInstruction(folder, name, purpose, key) },
        { thread },
      )
      .catch((error: unknown) => console.error("[basis] the API's view turn failed:", error));
    const view = issueViewId(key);
    return { status: 202, body: { view, name, thread, kitFolder: viewKitFolder(view) } };
  }
  if (what === "kit" && parts.length === 3 && method === "POST") {
    const body = await readJson(req);
    const key = body.issue === undefined ? null : issueKey(text(body.issue));
    if (body.issue !== undefined && !key) throw new ApiError(400, "Give the issue's key, such as WEB-12.");
    const views = key
      ? [issueViewId(key)]
      : Array.isArray(body.views)
        ? body.views.filter((view): view is string => typeof view === "string")
        : undefined;
    const folder =
      body.folder === undefined ? (key ? viewKitFolder(issueViewId(key)) : undefined) : kitFolder(text(body.folder));
    if (folder === null) throw new ApiError(400, "The kit's folder must be a path inside the product, without '..'.");
    let built;
    try {
      built = await options.buildKit(project, { views, folder });
    } catch (error) {
      const message = (error as Error).message;
      throw new ApiError(/None of the chosen views/.test(message) ? 404 : 500, message);
    }
    if (!built) throw new ApiError(409, "A verification kit is being built. Try again in a moment.");
    const zip = options.zip(built.files, built.summary.folder);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${built.summary.folder.replace(/\//g, "-")}.zip"`,
      "Content-Length": zip.byteLength,
      "Cache-Control": "no-store",
      "X-Basis-Kit-Folder": built.summary.folder,
      "X-Basis-Kit-Shots": String(built.summary.shots),
    });
    res.end(zip);
    return undefined;
  }
  throw new ApiError(404, "No such endpoint.");
}
