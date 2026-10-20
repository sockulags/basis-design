import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { CaptureView } from "../shared/capture.ts";
import { checkDiffRequest, reportPage, runDiff, targetUrl, Verifications } from "../server/diff.ts";

/** A page as the capture page or the product renders it: a coloured block, and an image placeholder at `mediaAt`. */
function page(color: string, mediaAt: number, ready: boolean): string {
  return `<!doctype html><html${ready ? " data-basis-ready" : ""}><body style="margin:0">
<div style="width:200px;height:60px;background:${color}"></div>
<div data-basis-media style="position:absolute;left:${mediaAt}px;top:70px;width:40px;height:40px;background:#888"></div>
<div style="height:120px"></div></body></html>`;
}

const VIEW: CaptureView = {
  id: "web-12",
  title: "WEB-12 Audit log",
  file: "views/Audit.specimen.tsx",
  screens: [{ id: "log", label: "Log", shots: [{ width: 320, viewportHeight: 200, fullPage: false, theme: "light" }] }],
};

describe("basis-diff", () => {
  let server: http.Server;
  let base = "";
  let root = "";
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "basis-diff-"));
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://local").pathname;
      const body =
        pathname === "/capture.html"
          ? page("#2a6", 10, true)
          : pathname === "/same"
            ? page("#2a6", 10, false)
            : pathname === "/moved"
              ? page("#2a6", 60, false)
              : page("#c33", 10, false);
      res.writeHead(200, { "Content-Type": "text/html" }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  const run = async (target: string, extra: Partial<Parameters<typeof checkDiffRequest>[0] & object> = {}) => {
    const store = new Verifications(path.join(root, "verifications"));
    const { id, dir } = await store.create("auth-service", VIEW.id);
    const report = await runDiff({
      captureUrl: `${base}/capture.html`,
      view: VIEW,
      project: "auth-service",
      designCommit: "abc123",
      request: checkDiffRequest({ targets: { baseUrl: base, screens: { log: target } }, ...extra }),
      dir,
      id,
    });
    return { store, report };
  };

  test("passes when Basis' photographs of the design and the product are the same", async () => {
    const { store, report } = await run("/same", { label: "WEB-12 at abc" });
    assert.equal(report.pass, true);
    assert.equal(report.shots[0]!.status, "pass");
    assert.equal(report.designCommit, "abc123");
    assert.equal(report.shots[0]!.url, `${base}/same`);
    assert.deepEqual(Object.keys(report.files).sort(), [
      "actual/web-12/log@320x200.png",
      "expected/web-12/log@320x200.png",
    ]);
    // Kept, listed and served with its images.
    assert.deepEqual((await store.get("auth-service", report.id))?.pass, true);
    assert.equal((await store.list("auth-service", "web-12"))[0]?.id, report.id);
    assert.ok(await store.file("auth-service", report.id, "actual/web-12/log@320x200.png"));
    assert.match(reportPage(report, "/f"), /Matches/);
  });

  test("fails with a diff image when the product looks different, whatever the requester declares", async () => {
    const whole = { name: "everything", reason: "trust me", screen: "log" };
    const { store, report } = await run("/other", { exceptions: [whole] });
    assert.equal(report.pass, false, "the verdict leaves out only media");
    assert.equal(report.shots[0]!.status, "fail");
    assert.ok((report.shots[0]!.percent ?? 0) > 0);
    assert.ok(report.files["diff/web-12/log@320x200.png"]);
    // The declared exception counts only in the second verdict, and is listed for a person to judge.
    assert.equal(report.passWithExceptions, true);
    assert.deepEqual(report.shots[0]!.withExceptions.exceptions, ["everything"]);
    assert.match(reportPage(report, "/f"), /Does not match[\s\S]*trust me/);
    // An image changed after the fact is not served.
    await writeFile(
      path.join(root, "verifications", "auth-service", report.id, "actual", "web-12", "log@320x200.png"),
      "x",
    );
    assert.equal(await store.file("auth-service", report.id, "actual/web-12/log@320x200.png"), null);
    assert.equal(await store.file("auth-service", report.id, "../../secret"), null);
  });

  test("checks the image placeholders' boxes, and says when a screen has no page", async () => {
    const { report } = await run("/moved");
    assert.equal(report.shots[0]!.status, "fail");
    assert.match(report.shots[0]!.problems.join(" "), /element 1 of "\[data-basis-media\]" is 40x40 at 60,70/);
    const none = await runDiff({
      captureUrl: `${base}/capture.html`,
      view: VIEW,
      project: "auth-service",
      designCommit: null,
      request: checkDiffRequest({ targets: { screens: {} } }),
      dir: path.join(root, "none"),
      id: "none",
    });
    assert.equal(none.shots[0]!.status, "missing");
    assert.equal(none.pass, false);
  });
});

test("a request names http pages per screen, by screen or view/screen", () => {
  const targets = {
    baseUrl: "http://localhost:3000",
    screens: { log: "/audit", "web-12/detail": { url: "/audit/1", waitFor: "h1" } },
  };
  assert.deepEqual(targetUrl(targets, "web-12", "log"), { url: "http://localhost:3000/audit" });
  assert.deepEqual(targetUrl(targets, "web-12", "detail"), { url: "http://localhost:3000/audit/1", waitFor: "h1" });
  assert.equal(targetUrl(targets, "web-12", "empty"), null);
  assert.throws(() => targetUrl({ screens: { log: "file:///etc/passwd" } }, "web-12", "log"), /only http and https/);
  assert.throws(() => checkDiffRequest({}), /Give targets/);
  assert.throws(() => checkDiffRequest({ targets: { screens: {} }, exceptions: "x" }), /exceptions is a list/);
});
