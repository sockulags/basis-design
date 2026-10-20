import { createHash, timingSafeEqual } from "node:crypto";
import type http from "node:http";

/*
 * Where Basis listens and who may use it. On a developer's machine it listens on 127.0.0.1 and answers only to
 * localhost: the agent it drives runs commands, so nothing else may reach it. In a container it listens on every
 * address (HOST=0.0.0.0) and answers to the host names in BASIS_HOSTS, and every page and socket needs the access
 * token (BASIS_ACCESS_TOKEN), given once on /login and kept in a cookie. Basis' own requests (its headless
 * browser's screenshots and checks, the agent's tool server) come from loopback to a loopback name and pass.
 */

export interface Network {
  /** The address the servers listen on. */
  listen: string;
  /** The address Basis reaches its own servers at. */
  self: string;
  /** Host names the browser may use, without a port. */
  hosts: string[];
  /** The token the pages need, or undefined when Basis only listens on loopback. */
  accessToken: string | undefined;
}

/** The names Basis answers to on loopback. Not [::1]: CSP's frame-ancestors cannot name IPv6 addresses. */
const LOOPBACK_NAMES = ["localhost", "127.0.0.1"];

export function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost" || address.startsWith("127.");
}

/** The network settings from the environment, or an error to stop on. */
export function networkFromEnv(env: NodeJS.ProcessEnv): Network | { error: string } {
  const listen = env.HOST?.trim() || "127.0.0.1";
  const wildcard = listen === "0.0.0.0" || listen === "::";
  const extra = (env.BASIS_HOSTS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (extra.some((name) => !/^[a-z0-9.-]+$/.test(name)))
    return { error: "BASIS_HOSTS lists host names without ports or schemes, separated by commas." };
  const accessToken = env.BASIS_ACCESS_TOKEN?.trim() || undefined;
  if (!isLoopback(listen) && (!accessToken || accessToken.length < 16)) {
    return {
      error:
        `Basis listens on ${listen}, where others can reach the agent it drives. Set BASIS_ACCESS_TOKEN to a ` +
        "secret of at least 16 characters; the pages ask for it once.",
    };
  }
  return {
    listen,
    self: wildcard ? "127.0.0.1" : listen,
    hosts: [...new Set([...LOOPBACK_NAMES, ...(wildcard || isLoopback(listen) ? [] : [listen]), ...extra])],
    accessToken: isLoopback(listen) ? undefined : accessToken,
  };
}

/** The origins the chrome on `port` may have: every allowed host, over http and https. */
export function chromeOriginsFor(network: Network, port: number): string[] {
  return network.hosts.flatMap((host) => [`http://${host}:${port}`, `https://${host}:${port}`]);
}

/**
 * True when a request names an allowed host with `port`. A web page that points its own name at Basis (DNS
 * rebinding) sends its own name, so it cannot read Basis' pages or the starter kit.
 */
export function isAllowedHost(req: http.IncomingMessage, network: Network, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return network.hosts.some((name) => host === `${name}:${port}`);
}

const COOKIE = "basis-access";

/** What the access cookie holds: a hash of the token, so the token itself never sits in the browser. */
function cookieValue(token: string): string {
  return createHash("sha256").update(`basis-access:${token}`).digest("hex");
}

function sameSecret(given: string, wanted: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(wanted);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when a request may use the pages: no token needed, the access cookie, or Basis' own loopback request. */
export function hasAccess(req: http.IncomingMessage, network: Network): boolean {
  if (!network.accessToken) return true;
  const fromSelf = isLoopback(req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "");
  const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (fromSelf && LOOPBACK_NAMES.includes(host)) return true;
  const cookie = (req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE)?.[1];
  return cookie !== undefined && sameSecret(cookie, cookieValue(network.accessToken));
}

const LOGIN_PAGE = (failed: boolean) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Basis</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111; color: #eee; font: 14px system-ui, sans-serif; }
  form { display: grid; gap: 10px; width: min(320px, 100vw - 32px); }
  input, button { font: inherit; padding: 8px 10px; border-radius: 6px; border: 1px solid #444; background: #1c1c1c; color: inherit; }
  button { background: #d7f36b; color: #111; border: 0; font-weight: 600; cursor: pointer; }
  p { margin: 0; color: ${failed ? "#ff8a80" : "#aaa"}; }
</style>
<form method="post" action="/login">
  <label for="token">Access token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
  <p>${failed ? "That is not the token." : "This Basis asks for its access token once per browser."}</p>
  <button type="submit">Open Basis</button>
</form>
</html>`;

/**
 * Answers /login: the form, and the form's post, which sets the cookie and goes to the app. True when it
 * answered. Only for the chrome's own origin, so another page cannot log a browser in.
 */
export async function handleLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  network: Network,
  origins: string[],
): Promise<boolean> {
  if (!network.accessToken || req.url?.split("?")[0] !== "/login") return false;
  if (req.method === "POST" && !origins.includes(req.headers.origin ?? "")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Log in from Basis itself.");
    return true;
  }
  const page = (status: number, failed: boolean) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(LOGIN_PAGE(failed));
  };
  if (req.method !== "POST") {
    page(200, false);
    return true;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) break;
  }
  const token = new URLSearchParams(raw).get("token") ?? "";
  if (!sameSecret(cookieValue(token), cookieValue(network.accessToken))) {
    page(401, true);
    return true;
  }
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.writeHead(303, {
    Location: "/",
    "Set-Cookie": `${COOKIE}=${cookieValue(network.accessToken)}; Path=/; HttpOnly; SameSite=Strict${secure}`,
    "Cache-Control": "no-store",
  });
  res.end();
  return true;
}

/** Sends a browser without access to the login form (on the chrome's port), and anything else away with 401. */
export function refuseAccess(req: http.IncomingMessage, res: http.ServerResponse, login: boolean): void {
  if (login && req.method === "GET" && (req.headers.accept ?? "").includes("text/html")) {
    res.writeHead(303, { Location: "/login", "Cache-Control": "no-store" });
  } else {
    res.writeHead(401, { "Content-Type": "text/plain" });
  }
  res.end(req.method === "GET" ? "" : "Log in to Basis first.");
}
