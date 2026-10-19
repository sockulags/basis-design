import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EnvironmentModuleNode, HotUpdateOptions, IndexHtmlTransformContext, Plugin, ViteDevServer } from "vite";
import { HOLD_EVENT, HOLD_META, holdMeta, readHoldMeta, RELEASE_EVENT } from "../shared/hold.ts";
import type { DesignState, ServerMessage } from "../shared/protocol.ts";
import { invalidate, PreviewHold } from "../server/hold.ts";

/** A hold with what it broadcasts to the chrome and sends to the preview's pages written down. */
function setup() {
  const broadcast: ServerMessage[] = [];
  const sent: { event: string; payload?: unknown }[] = [];
  const hold = new PreviewHold((message) => broadcast.push(message));
  const plugin = hold.plugin();
  const server = {
    environments: { client: { hot: { send: (event: string, payload?: unknown) => sent.push({ event, payload }) } } },
  };
  (plugin.configureServer as (server: ViteDevServer) => void)(server as unknown as ViteDevServer);
  const invalidated: { mod: unknown; timestamp?: number; isHmr?: boolean }[] = [];
  const graph = {
    invalidateModule: (mod: unknown, _seen?: unknown, timestamp?: number, isHmr?: boolean) =>
      invalidated.push({ mod, timestamp, isHmr }),
  };
  const update = (modules: unknown[]) =>
    (plugin.hotUpdate as { handler: (this: unknown, options: HotUpdateOptions) => unknown }).handler.call(
      { environment: { moduleGraph: graph } },
      { type: "update", file: "/w/views/Team.specimen.tsx", timestamp: 7, modules } as unknown as HotUpdateOptions,
    );
  return { hold, plugin, broadcast, sent, invalidated, update };
}

const design = (name: string) => ({ type: "design", design: { design: { name } } as unknown as DesignState }) as const;

function meta(plugin: Plugin, path: string): unknown {
  const transform = plugin.transformIndexHtml as (html: string, context: IndexHtmlTransformContext) => unknown;
  return transform("<html></html>", { path, filename: path.slice(1) });
}

describe("the preview's hold", () => {
  test("passes code updates and messages on while no turn runs", () => {
    const { hold, broadcast, update } = setup();
    assert.equal(update([{ id: "a" }]), undefined, "Vite's own update goes ahead");
    hold.send(design("Before"));
    assert.deepEqual(broadcast, [design("Before")]);
    assert.equal(hold.release(), null, "a release without a hold does nothing");
  });

  test("drops code updates during a turn but invalidates them, so a fresh page load sees the files as they are", () => {
    const { hold, sent, invalidated, update } = setup();
    hold.hold();
    assert.deepEqual(sent, [{ event: HOLD_EVENT, payload: undefined }]);
    const modules = [{ id: "specimens.tsx" }, { id: "Team.specimen.tsx" }];
    assert.deepEqual(update(modules), []);
    assert.deepEqual(
      invalidated,
      modules.map((mod) => ({ mod, timestamp: 7, isHmr: true })),
    );
    assert.equal(hold.waiting, true);
  });

  test("keeps the latest design and review for the end of the turn, and says once that the preview waits", () => {
    const { hold, broadcast } = setup();
    hold.hold();
    hold.send(design("Half"));
    hold.send(design("Done"));
    hold.send({ type: "review", review: null });
    assert.deepEqual(broadcast, [{ type: "preview-waiting", waiting: true }]);
    assert.equal(hold.release(), 1);
    assert.deepEqual(broadcast.slice(1), [
      design("Done"),
      { type: "review", review: null },
      { type: "preview-waiting", waiting: false },
    ]);
    assert.equal(hold.waiting, false);
  });

  test("reloads the gallery once per turn that changed something, each time in a new generation", () => {
    const { hold, plugin, sent, update } = setup();
    hold.hold();
    update([{ id: "a" }]);
    assert.deepEqual(readHoldMeta(content(meta(plugin, "/preview.html"))), { generation: 0, held: true });
    assert.equal(hold.release(), 1);
    assert.deepEqual(sent.at(-1), { event: RELEASE_EVENT, payload: { reload: true } });
    assert.deepEqual(readHoldMeta(content(meta(plugin, "/preview.html"))), { generation: 1, held: false });

    hold.hold();
    // A file nothing loaded (not in the module graph) changes nothing the gallery shows.
    update([]);
    assert.equal(hold.release(), null);
    assert.deepEqual(sent.at(-1), { event: RELEASE_EVENT, payload: { reload: false } });

    hold.hold();
    update([{ id: "b" }]);
    assert.equal(hold.release(), 2);
  });

  test("tells only gallery documents their generation, not the capture page", () => {
    const { plugin } = setup();
    assert.equal(meta(plugin, "/capture.html"), undefined);
    assert.ok(Array.isArray(meta(plugin, "/preview.html")));
  });
});

function content(tags: unknown): string {
  const [tag] = tags as { attrs: { name: string; content: string } }[];
  assert.equal(tag?.attrs.name, HOLD_META);
  return tag.attrs.content;
}

test("invalidating shares one set of seen modules, as Vite's own update does", () => {
  const seen: unknown[] = [];
  const graph = { invalidateModule: (_mod: unknown, set?: Set<unknown>) => seen.push(set) };
  invalidate(graph, [{}, {}] as EnvironmentModuleNode[], 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

test("the meta tag reads back what was written, and anything else as generation 0, not held", () => {
  assert.deepEqual(readHoldMeta(holdMeta({ generation: 3, held: true })), { generation: 3, held: true });
  assert.deepEqual(readHoldMeta(undefined), { generation: 0, held: false });
  assert.deepEqual(readHoldMeta("{"), { generation: 0, held: false });
  assert.deepEqual(readHoldMeta('{"generation":-2,"held":"yes"}'), { generation: 0, held: false });
  assert.deepEqual(readHoldMeta('{"generation":1.5}'), { generation: 0, held: false });
});
