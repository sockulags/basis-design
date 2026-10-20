import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { Annotation } from "../../shared/annotations.ts";
import type { FromPreview, PreviewView, ToPreview } from "../../shared/frame.ts";
import { HOLD_EVENT, HOLD_META, readHoldMeta, RELEASE_EVENT, type ReleasePayload } from "../../shared/hold.ts";
import {
  clearProblems,
  currentFindings,
  currentProblems,
  describe,
  hotUpdated,
  onFindings,
  onProblems,
  setChecking,
  setProblem,
} from "./errors.ts";
import { onOwnFindings, setCopyFindings } from "./a11y.ts";
import { PickLayer, PickMarkers, type Pick } from "./picker/PickLayer.tsx";
import { requestReveal, stillRendering } from "./progressive.ts";
import type { Preview as PreviewComponent } from "./Preview.tsx";
import "./preview.css";

/*
 * The design system specimen, running in a sandboxed iframe on its own origin.
 * It only talks to the chrome that embeds it, and only through postMessage.
 */

const params = new URLSearchParams(location.search);
/**
 * This document is the preview's hidden copy in the other theme (see ThemeChecker), embedded by the preview on
 * the same origin. It renders the same view and reports nothing but the findings of its checks of the demos.
 */
const themeCheck = params.has("theme-check");
const parentOrigin = themeCheck ? location.origin : (params.get("parent") ?? "");
const trustedParent =
  (themeCheck || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(parentOrigin)) && window.parent !== window;

if (themeCheck) {
  // A hidden frame does not play transitions, so a theme switch would leave colours halfway between the themes.
  // The check measures end states only.
  const still = document.createElement("style");
  still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.append(still);
}

function post(message: FromPreview): void {
  if (!trustedParent || (themeCheck && message.type !== "ready" && message.type !== "checks")) return;
  window.parent.postMessage(message, parentOrigin);
}

// The gallery is a showcase: links must never navigate, whether to "#" (which jumps to the top) or away
// from the preview. Components' own click handlers still run first.
window.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
});

/** What the preview server served this document with: its generation, and whether a turn holds the preview. */
const served = readHoldMeta(document.querySelector<HTMLMetaElement>(`meta[name="${HOLD_META}"]`)?.content);
/**
 * While an agent turn runs, the preview server holds the gallery's updates (server/hold.ts), so it shows the
 * workspace as it was until the turn ends. Errors Vite reports meanwhile come from other pages loading the turn's
 * half-done files (the agent's screenshots), not from what the gallery shows; Vite's overlay for them stays hidden.
 */
let held = false;
/** An error was left out while held: the gallery reloads at the release even if nothing it shows changed. */
let missed = false;
function setHeld(value: boolean): void {
  held = value;
  document.documentElement.toggleAttribute("data-basis-held", value);
}
setHeld(served.held);

/** Until the gallery first renders, the fix loop must not take its empty lists for a clean result. */
const LOADING = "Loading the gallery";
if (!themeCheck) setChecking(LOADING, true);

const PLACE = "basis:place";

/** Reloads the gallery to show what a turn changed, keeping where it was scrolled to. */
function reloadInPlace(): void {
  // The section at the top of the viewport and how far into it, since sections above may change height.
  const top = [...document.querySelectorAll<HTMLElement>("section[id]")].findLast(
    (section) => section.getBoundingClientRect().top <= 0,
  );
  const place = { y: window.scrollY, id: top?.id, offset: top ? -top.getBoundingClientRect().top : 0 };
  try {
    sessionStorage.setItem(PLACE, JSON.stringify(place));
  } catch {
    // Only a convenience: the gallery then starts at the top.
  }
  // The gallery renders progressively, so the browser's own restoring would land short; restorePlace does it.
  history.scrollRestoration = "manual";
  location.reload();
}

/** Scrolls back to where reloadInPlace left, once the gallery has rendered. */
function restorePlace(): void {
  const place = takePlace();
  if (!place) return;
  const id = typeof place.id === "string" ? place.id : "";
  // Sections further down may not be rendered yet; render everything up to this one first.
  if (id) requestReveal(id);
  const section = id ? document.getElementById(id) : null;
  const y = section
    ? section.getBoundingClientRect().top + window.scrollY + Number(place.offset ?? 0)
    : Number(place.y ?? 0);
  window.scrollTo(0, Number.isFinite(y) ? y : 0);
}

function takePlace(): { y?: unknown; id?: unknown; offset?: unknown } | null {
  try {
    const place = JSON.parse(sessionStorage.getItem(PLACE) ?? "null") as Record<string, unknown> | null;
    sessionStorage.removeItem(PLACE);
    return place && typeof place === "object" ? place : null;
  } catch {
    return null;
  }
}

window.addEventListener("error", (event) => setProblem("Uncaught error", describe(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => setProblem("Unhandled rejection", describe(event.reason)));
if (import.meta.hot) {
  import.meta.hot.on(HOLD_EVENT, () => setHeld(true));
  import.meta.hot.on(RELEASE_EVENT, (payload: ReleasePayload) => {
    // One reload shows the turn's result: no module that failed mid-turn and no error from before stays behind. The
    // copy in the other theme is reloaded with the gallery that embeds it.
    if ((payload.reload || missed) && !themeCheck) return reloadInPlace();
    setHeld(false);
  });
  import.meta.hot.on("vite:error", (payload: { err?: { message?: string; id?: string } }) => {
    if (held) {
      missed = true;
      return;
    }
    // Past versions a review shows are history, not the agent's to fix (their panes do not report either).
    if (`${payload.err?.id ?? ""} ${payload.err?.message ?? ""}`.includes("/.basis/snapshots/")) return;
    const where = payload.err?.id ? ` in ${payload.err.id.split("/components/").pop()}` : "";
    setProblem("Compile error", `${payload.err?.message?.split("\n")[0] ?? "unknown"}${where}`);
  });
  import.meta.hot.on("vite:afterUpdate", () => {
    clearProblems("Compile error");
    clearProblems("Uncaught error");
    clearProblems("Unhandled rejection");
    hotUpdated();
  });
}

/** Reports the section nearest the top of the viewport; a new `view` key (page, or the review opening or closing) restarts it. */
function useScrollSpy(view: string | null): void {
  useEffect(() => {
    if (view === null) return;
    let raf = 0;
    let last = "";
    const measure = () => {
      const sections = [...document.querySelectorAll<HTMLElement>("section[id]")];
      let current = sections[0]?.id ?? "";
      for (const section of sections) if (section.getBoundingClientRect().top <= 120) current = section.id;
      const root = document.scrollingElement;
      if (
        root &&
        root.scrollHeight > root.clientHeight + 2 &&
        root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      ) {
        current = sections.at(-1)?.id ?? current;
      }
      if (current && current !== last) {
        last = current;
        post({ type: "active-section", id: current });
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [view]);
}

/** The run each hidden copy counts as: the other theme's, and the whole page's in this theme. */
const OTHER_THEME_RUN = "Checks of the demos in the other theme";
const WHOLE_PAGE_RUN = "Checks of the whole page";

/**
 * The checks of the demos need them rendered in a theme to check them in it, and the user sees one theme at a time,
 * and often one card's section (or an overview of cards) rather than the whole page. So the preview keeps hidden
 * copies of itself: same-origin frames the user never sees (transparent, inert, behind the page) but laid out at
 * the same size, so axe measures real colours and layout. One shows the whole page in the other theme; while the
 * user looks at less than the whole page, another shows it in this theme. They also show every block at phone
 * width (see Preview), so the layout check always covers a phone. Their findings join this document's.
 */
function Checker({ view, otherTheme, run }: { view: PreviewView; otherTheme: boolean; run: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [generation, setGeneration] = useState(0);
  // The copy checks the whole page (or the review), never a view in full screen, so moves there do not reach it.
  const { design, theme, page, review, widths } = view;
  const checked = useMemo<PreviewView>(
    () => ({
      design,
      theme: otherTheme ? (theme === "dark" ? "light" : "dark") : theme,
      page,
      review,
      fullscreen: null,
      widths,
      focus: null,
      all: true,
    }),
    [design, theme, page, review, widths, otherTheme],
  );

  useEffect(() => {
    // The copy's checks count as running until it first reports, so the fix loop waits for it after a reload.
    setCopyFindings(run, [], true);
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      const message = event.data as { type?: unknown; checks?: unknown; running?: unknown } | null;
      if (message?.type === "ready") setGeneration((value) => value + 1);
      else if (message?.type === "checks" && Array.isArray(message.checks)) {
        const checks = message.checks.filter((item): item is string => typeof item === "string");
        setCopyFindings(run, checks, message.running === true);
      }
    };
    window.addEventListener("message", listen);
    return () => {
      window.removeEventListener("message", listen);
      setCopyFindings(run, [], false);
    };
  }, [run]);

  useEffect(() => {
    if (generation === 0) return;
    const message: ToPreview = { type: "render", view: checked };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  }, [generation, checked]);

  return (
    <iframe
      ref={frame}
      src={`${location.pathname}?theme-check`}
      title={otherTheme ? "Checks in the other theme" : "Checks of the whole page"}
      aria-hidden
      tabIndex={-1}
      inert
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        opacity: 0,
        pointerEvents: "none",
        zIndex: -1,
      }}
    />
  );
}

type PreviewType = typeof PreviewComponent;

/**
 * Loaded dynamically: the gallery imports the workspace's components and
 * specimens, and if those fail to compile the error is reported to the chrome
 * instead of leaving an empty frame.
 */
function usePreviewModule(): ComponentType<Parameters<PreviewType>[0]> | null {
  const [module, setModule] = useState<{ Preview: PreviewType } | null>(null);
  useEffect(() => {
    import("./Preview.tsx").then(
      (loaded) => {
        clearProblems("Gallery failed to load");
        setModule(loaded);
      },
      (error: unknown) => {
        setProblem("Gallery failed to load", describe(error));
        setChecking(LOADING, false);
        // A failed module stays failed in this document; reload once the next edit lands.
        import.meta.hot?.on("vite:afterUpdate", () => location.reload());
      },
    );
  }, []);
  return module?.Preview ?? null;
}

function PreviewApp() {
  const [view, setView] = useState<PreviewView | null>(null);
  const Preview = usePreviewModule();
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToPreview>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const message = event.data;
      switch (message?.type) {
        case "render": {
          const next = message.view;
          setView((current) => {
            // A new page, section or way of showing it, or a review opening or closing, starts at the top.
            const moved =
              current &&
              (current.page !== next.page ||
                current.focus !== next.focus ||
                current.all !== next.all ||
                Boolean(current.review) !== Boolean(next.review));
            if (moved) requestAnimationFrame(() => window.scrollTo(0, 0));
            return next;
          });
          return;
        }
        case "scroll-to": {
          // A section further down may not be rendered yet; render everything up to it first, so it lands right.
          requestReveal(message.id);
          // While sections are still being added, a smooth scroll gets cancelled by the layout changes; jump instead.
          const instant = stillRendering() || matchMedia("(prefers-reduced-motion: reduce)").matches;
          document
            .getElementById(message.id)
            ?.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "start" });
          return;
        }
        case "picking":
          setPicking(message.on);
          return;
        case "picks-remove":
          setPicks((current) => current.filter((_, index) => index !== message.index));
          return;
        case "picks-clear":
          setPicks([]);
          return;
        case "blink-key":
          window.dispatchEvent(new KeyboardEvent(message.down ? "keydown" : "keyup", { key: "b" }));
          return;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready", generation: served.generation });
    // A fresh document reports what it shows from the start, so nothing an earlier one reported lingers.
    post({ type: "errors", errors: currentProblems() });
    if (!themeCheck) post({ type: "checks", ...currentFindings() });
    const stop = onProblems((errors) => post({ type: "errors", errors }));
    const stopChecks = (themeCheck ? onOwnFindings : onFindings)((checks, running) =>
      post({ type: "checks", checks, running }),
    );
    return () => {
      window.removeEventListener("message", onMessage);
      stop();
      stopChecks();
    };
  }, []);

  useEffect(() => {
    post({ type: "picks", annotations: picks.map((pick): Annotation => pick.annotation) });
  }, [picks]);

  // Match the page background to the design so overscroll never flashes white.
  useEffect(() => {
    const ds = document.querySelector<HTMLElement>(".ds-root");
    if (ds) document.body.style.background = getComputedStyle(ds).backgroundColor;
  }, [view]);

  useScrollSpy(view && Preview ? `${view.page}|${view.focus ?? ""}|${view.all}|${view.review ? "review" : ""}` : null);

  // Rendered for the first time: the checks it scheduled take over from loading (the gallery's effects run first),
  // and a gallery reloaded after a turn goes back to where it was.
  const shown = Boolean(view && Preview);
  useEffect(() => {
    if (!shown) return;
    setChecking(LOADING, false);
    if (!themeCheck) setTimeout(restorePlace, 0);
  }, [shown]);

  const toggle = useCallback((annotation: Annotation, element: HTMLElement) => {
    setPicks((current) =>
      current.some((pick) => pick.element === element)
        ? current.filter((pick) => pick.element !== element)
        : [...current, { annotation, element }],
    );
  }, []);

  const done = useCallback(() => {
    setPicking(false);
    post({ type: "picking", on: false });
  }, []);

  if (!view || !Preview) return null;
  if (themeCheck) return <Preview view={view} post={post} themeCheck />;
  return (
    <>
      <div ref={root}>
        <Preview view={view} post={post} />
      </div>
      <Checker view={view} otherTheme run={OTHER_THEME_RUN} />
      {/* The user sees less than the whole page: a copy in this theme checks the rest. */}
      {!view.review && !view.all && <Checker view={view} otherTheme={false} run={WHOLE_PAGE_RUN} />}
      {picks.length > 0 && <PickMarkers picks={picks} />}
      {picking && <PickLayer container={root} design={view.design} picks={picks} onToggle={toggle} onDone={done} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
