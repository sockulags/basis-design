import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import {
  chromeOriginsFor,
  handleLogin,
  hasAccess,
  isAllowedHost,
  networkFromEnv,
  refuseAccess,
  type Network,
} from "../server/network.ts";

const TOKEN = "a-secret-of-some-length";

function network(env: NodeJS.ProcessEnv): Network {
  const result = networkFromEnv(env);
  if ("error" in result) throw new Error(result.error);
  return result;
}

/** A request as the server sees it, from `remote`. */
function request(headers: http.IncomingHttpHeaders, remote = "10.0.0.7"): http.IncomingMessage {
  return { headers, socket: { remoteAddress: remote } } as unknown as http.IncomingMessage;
}

test("on a developer's machine Basis listens on loopback, answers to localhost, and needs no token", () => {
  const local = network({});
  assert.equal(local.listen, "127.0.0.1");
  assert.equal(local.self, "127.0.0.1");
  assert.equal(local.accessToken, undefined);
  assert.ok(isAllowedHost(request({ host: "localhost:5320" }), local, 5320));
  assert.ok(!isAllowedHost(request({ host: "evil.example:5320" }), local, 5320));
  assert.ok(!isAllowedHost(request({ host: "localhost:5321" }), local, 5320));
  assert.ok(hasAccess(request({ host: "localhost:5320" }), local));
  assert.deepEqual(chromeOriginsFor(local, 5320).slice(0, 2), ["http://localhost:5320", "https://localhost:5320"]);
});

test("in a container it needs a token, and answers to the host names it is given", () => {
  assert.match((networkFromEnv({ HOST: "0.0.0.0" }) as { error: string }).error, /BASIS_ACCESS_TOKEN/);
  assert.match((networkFromEnv({ HOST: "0.0.0.0", BASIS_ACCESS_TOKEN: "short" }) as { error: string }).error, /16/);
  assert.match(
    (networkFromEnv({ HOST: "0.0.0.0", BASIS_ACCESS_TOKEN: TOKEN, BASIS_HOSTS: "https://x" }) as { error: string })
      .error,
    /without ports or schemes/,
  );
  const container = network({ HOST: "0.0.0.0", BASIS_ACCESS_TOKEN: TOKEN, BASIS_HOSTS: "Basis.Internal, 10.1.2.3" });
  assert.equal(container.self, "127.0.0.1");
  assert.equal(container.accessToken, TOKEN);
  assert.ok(isAllowedHost(request({ host: "basis.internal:5320" }), container, 5320));
  assert.ok(isAllowedHost(request({ host: "10.1.2.3:5321" }), container, 5321));
  assert.ok(!isAllowedHost(request({ host: "other.internal:5320" }), container, 5320));
  assert.ok(chromeOriginsFor(container, 5320).includes("https://basis.internal:5320"));
  // A specific address is where Basis reaches itself too.
  assert.equal(network({ HOST: "10.1.2.3", BASIS_ACCESS_TOKEN: TOKEN }).self, "10.1.2.3");
});

test("in a container a page needs the cookie, except Basis' own requests from loopback", () => {
  const container = network({ HOST: "0.0.0.0", BASIS_ACCESS_TOKEN: TOKEN, BASIS_HOSTS: "basis.internal" });
  assert.ok(!hasAccess(request({ host: "basis.internal:5320" }), container));
  assert.ok(!hasAccess(request({ host: "basis.internal:5320", cookie: "basis-access=nope" }), container));
  assert.ok(hasAccess(request({ host: "127.0.0.1:5321" }, "127.0.0.1"), container));
  assert.ok(hasAccess(request({ host: "localhost:5321" }, "::ffff:127.0.0.1"), container));
  // From loopback, but naming the outside host: a proxy in the pod, so the cookie is still needed.
  assert.ok(!hasAccess(request({ host: "basis.internal:5320" }, "127.0.0.1"), container));
  // From outside, but naming localhost: no.
  assert.ok(!hasAccess(request({ host: "localhost:5320" }), container));
});

describe("logging in", () => {
  const container = network({ HOST: "0.0.0.0", BASIS_ACCESS_TOKEN: TOKEN, BASIS_HOSTS: "basis.internal" });
  const origins = chromeOriginsFor(container, 5320);
  let server: http.Server;
  let base = "";
  before(async () => {
    server = http.createServer((req, res) => {
      void handleLogin(req, res, container, origins).then((answered) => {
        if (answered) return;
        if (!hasAccess(req, container)) return refuseAccess(req, res, true);
        res.end("the app");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => server.close());

  /** A request naming the outside host, as a browser through the container's published port sends it. */
  function send(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = http.request(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: { Host: "basis.internal:5320", ...init.headers },
      });
      req.on("response", (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(init.body);
    });
  }

  test("sends a browser to the form, and anything else away", async () => {
    const page = await send("/", { headers: { Accept: "text/html" } });
    assert.equal(page.status, 303);
    assert.equal(page.headers.location, "/login");
    assert.equal((await send("/x.js")).status, 401);
    assert.match((await send("/login")).text, /Access token/);
  });

  test("takes the token only from its own origin, and gives a cookie that opens the app", async () => {
    const post = (token: string, origin: string) =>
      send("/login", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    assert.equal((await post(TOKEN, "https://evil.example")).status, 403);
    assert.equal((await post("wrong", "http://basis.internal:5320")).status, 401);
    const ok = await post(TOKEN, "http://basis.internal:5320");
    assert.equal(ok.status, 303);
    const cookie = String(ok.headers["set-cookie"]?.[0] ?? "");
    assert.match(cookie, /^basis-access=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict$/);
    assert.ok(!cookie.includes(TOKEN));
    const app = await send("/", { headers: { Cookie: cookie.split(";")[0]! } });
    assert.equal(app.text, "the app");
  });
});
