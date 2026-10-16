import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Annotation } from "../../shared/annotations.ts";
import type { FromPreview, ToPreview } from "../../shared/frame.ts";
import type { Design } from "../../shared/design.ts";
import { clearProblems, describe, hotUpdated, onProblems, setProblem } from "./errors.ts";
import { PickLayer, PickMarkers, type Pick } from "./picker/PickLayer.tsx";
import { Preview } from "./Preview.tsx";
import "./preview.css";

/*
 * The design system specimen, running in a sandboxed iframe on its own origin.
 * It only talks to the chrome that embeds it, and only through postMessage.
 */

const parentOrigin = new URLSearchParams(location.search).get("parent") ?? "";
const trustedParent = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(parentOrigin) && window.parent !== window;

function post(message: FromPreview): void {
  if (trustedParent) window.parent.postMessage(message, parentOrigin);
}

window.addEventListener("error", (event) => setProblem("Uncaught error", describe(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => setProblem("Unhandled rejection", describe(event.reason)));
if (import.meta.hot) {
  import.meta.hot.on("vite:error", (payload: { err?: { message?: string; id?: string } }) => {
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

interface View {
  design: Design;
  theme: "light" | "dark";
}

/** Reports the section nearest the top of the viewport. */
function useScrollSpy(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = "";
    const measure = () => {
      const sections = [...document.querySelectorAll<HTMLElement>("section[id]")];
      let current = sections[0]?.id ?? "";
      for (const section of sections) if (section.getBoundingClientRect().top <= 120) current = section.id;
      const root = document.scrollingElement;
      if (root && root.scrollHeight > root.clientHeight + 2 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
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
  }, [enabled]);
}

function PreviewApp() {
  const [view, setView] = useState<View | null>(null);
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToPreview>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const message = event.data;
      switch (message?.type) {
        case "render":
          setView({ design: message.design, theme: message.theme });
          return;
        case "scroll-to": {
          const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
          document.getElementById(message.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    const stop = onProblems((errors) => post({ type: "errors", errors }));
    return () => {
      window.removeEventListener("message", onMessage);
      stop();
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

  useScrollSpy(view !== null);

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

  if (!view) return null;
  return (
    <>
      <div ref={root}>
        <Preview design={view.design} theme={view.theme} onAsk={(prefix) => post({ type: "ask", prefix })} />
      </div>
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
