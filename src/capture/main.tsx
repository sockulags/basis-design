import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { captureShots, READY_ATTRIBUTE, type CaptureList } from "../../shared/capture.ts";
import { parseDesignText, type Design } from "../../shared/design.ts";
import { previewCss } from "../../shared/tokens.ts";
import type { ScreenProps, SpecimenBlock } from "../../template/components/specimen.ts";
import { loadSpecimens, SpecimenBlocks, type LoadedSpecimen } from "../preview/specimens.tsx";
import "./capture.css";
import styles from "./Specimen.module.css";

/*
 * One screen of a view, alone on the page at the size the browser gives it, for the verification kit's
 * screenshots: `?view=<view id>&screen=<screen id>&theme=light|dark`. `?specimen=<id>&theme=light|dark` renders
 * one specimen's blocks the way the gallery does, without its section header, for Basis' own screenshots
 * (server/screenshots.ts). `?list` instead reports every specimen, every view and the shots its screens ask for
 * (window.__basisCapture). The design comes from design.json beside this page, so the same page runs on Basis'
 * preview server and as the kit's static copy of the design.
 */

declare global {
  interface Window {
    __basisCapture?: CaptureList;
  }
}

const params = new URLSearchParams(location.search);
type FlowBlock = Extract<SpecimenBlock, { kind: "flow" }>;

function flows(specimen: LoadedSpecimen): FlowBlock[] {
  return specimen.blocks.filter((block): block is FlowBlock => block.kind === "flow");
}

function list(): CaptureList {
  const { specimens, problems } = loadSpecimens();
  const views = specimens
    .filter((specimen) => specimen.page === "views")
    .map((specimen) => ({
      id: specimen.id,
      title: specimen.title,
      file: specimen.file,
      screens: flows(specimen).flatMap((flow) =>
        flow.screens.map((screen) => ({ id: screen.id, label: screen.label, shots: captureShots(flow.capture) })),
      ),
    }))
    .filter((view) => view.screens.length > 0);
  return {
    specimens: specimens.map(({ id, title, page }) => ({ id, title, page })),
    views,
    problems: problems.map((problem) => `${problem.file}: ${problem.message}`),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marks the page ready once it has settled: fonts loaded, images decoded, and the layout the same size twice in
 * a row. Timers rather than animation frames, which a background tab does not run.
 */
async function markReady(): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  let last = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(50);
    const size = `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`;
    if (size === last) break;
    last = size;
  }
  document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch() {
    document.documentElement.setAttribute("data-basis-error", "true");
  }
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <p className="capture-problem">This screen failed to render: {String(error)}</p>;
  }
}

function Screen({ design, theme }: { design: Design; theme: "light" | "dark" }) {
  const { specimens } = useMemo(() => loadSpecimens(), []);
  const view = specimens.find((specimen) => specimen.page === "views" && specimen.id === params.get("view"));
  const screens = view ? flows(view).flatMap((flow) => flow.screens) : [];
  // The kit's copy of the design is clickable: `go` moves through the flow as in the gallery.
  const [position, setPosition] = useState<{ id: string; data?: unknown }>({
    id: params.get("screen") ?? screens[0]?.id ?? "",
  });
  const screen = screens.find((item) => item.id === position.id);

  useEffect(() => {
    void markReady();
  }, [position]);

  if (!view || !screen) {
    return (
      <p className="capture-problem">
        No screen "{position.id}" in the view "{params.get("view")}".
      </p>
    );
  }
  const go: ScreenProps["go"] = (id, data) => {
    const next = new URLSearchParams(location.search);
    next.set("screen", id);
    history.replaceState(null, "", `?${next}`);
    document.documentElement.removeAttribute(READY_ATTRIBUTE);
    setPosition({ id, data });
  };
  const Render = screen.render;
  return (
    <div className="ds-root" data-theme={theme}>
      <Boundary key={screen.id}>
        <Render design={design as unknown as ScreenProps["design"]} go={go} data={position.data} />
      </Boundary>
    </div>
  );
}

/** One specimen alone, as the gallery renders it at the width of its column. */
function SpecimenAlone({ design, theme }: { design: Design; theme: "light" | "dark" }) {
  const { specimens } = useMemo(() => loadSpecimens(), []);
  const specimen = specimens.find((item) => item.id === params.get("specimen"));

  useEffect(() => {
    void markReady();
  }, []);

  if (!specimen) return <p className="capture-problem">No specimen "{params.get("specimen")}".</p>;
  return (
    <div className="ds-root" data-theme={theme}>
      <div className={styles.specimen}>
        <Boundary>
          <SpecimenBlocks specimen={specimen} design={design} />
        </Boundary>
      </div>
    </div>
  );
}

function Page({ design }: { design: Design }) {
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  return (
    <>
      <style>{previewCss(design, ".ds-root")}</style>
      {design.typography.fontImports.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {params.has("specimen") ? (
        <SpecimenAlone design={design} theme={theme} />
      ) : (
        <Screen design={design} theme={theme} />
      )}
    </>
  );
}

async function start(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  if (params.has("list")) {
    window.__basisCapture = list();
    document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
    return;
  }
  const result = parseDesignText(await (await fetch("./design.json", { cache: "no-store" })).text());
  if (!result.ok) {
    root.render(<p className="capture-problem">design.json is not valid: {result.errors.join("; ")}</p>);
    document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
    return;
  }
  root.render(<Page design={result.design} />);
}

void start();
