import { createElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Design } from "../../shared/design.ts";
import type { FromPreview, FullScreenView } from "../../shared/frame.ts";
import barCss from "./FullScreenBar.css?inline";
import styles from "./FullScreen.module.css";
import previewStyles from "./Preview.module.css";
import { requestReveal } from "./progressive.ts";
import { SectionBoundary } from "./SectionBoundary.tsx";
import { flowScreens, type FlowPosition, type LoadedSpecimen } from "./specimens.tsx";

/*
 * A view alone, filling the screen, as it would look in the product: one screen at the width the browser gives
 * it, with no gallery around it. The chrome decides whether a view is in full screen (`fullscreen` in the
 * PreviewView) and makes the frame fill the screen; this document keeps where the flow is while it stays there.
 */

interface Place {
  specimen: string;
  position: FlowPosition;
  theme: "light" | "dark";
}

/** Where the view in full screen is, for this frame's next document: the gallery reloads after every turn. */
const KEPT = "basis:fullscreen";

function keep(place: Place | null): void {
  try {
    if (place) {
      const { specimen, position, theme } = place;
      sessionStorage.setItem(KEPT, JSON.stringify({ specimen, screen: position.id, theme }));
    } else sessionStorage.removeItem(KEPT);
  } catch {
    // Only a convenience: a reloaded preview then shows the screen the view opened on.
  }
}

/** The place this frame's last document kept for the view, or where the chrome says it opened. */
function restore(fullscreen: FullScreenView): Place {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? "null") as Record<string, unknown> | null;
    if (kept?.specimen === fullscreen.view && typeof kept.screen === "string") {
      return {
        specimen: fullscreen.view,
        position: { id: kept.screen },
        theme: kept.theme === "dark" ? "dark" : "light",
      };
    }
  } catch {
    // Falls through to where the view opened.
  }
  return { specimen: fullscreen.view, position: { id: fullscreen.screen }, theme: fullscreen.theme };
}

/**
 * Which view is in full screen and where its flow is. A view opens from its screen strip at the screen it was
 * on, with what the screens passed along. Moves stay in this document (a message to the chrome would come back
 * as a new view and run the checks again), kept for the next one, so the reload after a turn comes back to the
 * same screen and theme. When it leaves, the gallery's copies of the view go to the screen it was left on.
 */
export function useFullScreen(
  fullscreen: FullScreenView | null,
  theme: "light" | "dark",
  post: (message: FromPreview) => void,
) {
  const [place, setPlace] = useState<Place | null>(null);
  const [left, setLeft] = useState<{ specimen: string; position: FlowPosition } | null>(null);
  const latest = useRef(place);
  const wasShown = useRef(false);
  useEffect(() => {
    latest.current = place;
  });

  useEffect(() => {
    const current = latest.current;
    if (!fullscreen) {
      if (wasShown.current && current) {
        setLeft({ specimen: current.specimen, position: current.position });
        backToSection(current.specimen);
        keep(null);
      }
      wasShown.current = false;
      setPlace(null);
      return;
    }
    wasShown.current = true;
    // A fresh document (the reload after a turn) starts where the last one was; otherwise this one knows best.
    if (current?.specimen !== fullscreen.view) setPlace(restore(fullscreen));
  }, [fullscreen]);

  const shown = place && fullscreen?.view === place.specimen ? place : null;
  useEffect(() => {
    if (shown) keep(shown);
  }, [shown]);

  const open = useCallback(
    (specimen: string, position: FlowPosition) => {
      setPlace({ specimen, position, theme });
      post({ type: "fullscreen-open", view: specimen, screen: position.id, theme });
    },
    [post, theme],
  );
  const move = useCallback((position: FlowPosition) => setPlace((current) => current && { ...current, position }), []);
  const setTheme = useCallback(
    (next: "light" | "dark") => setPlace((current) => current && { ...current, theme: next }),
    [],
  );
  const exit = useCallback(() => post({ type: "fullscreen-exit" }), [post]);
  return { shown, left, open, move, setTheme, exit };
}

/** Back in the gallery, the view that was in full screen is in sight, once the frame has its own size again. */
function backToSection(id: string): void {
  const scroll = () => {
    requestReveal(id);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };
  setTimeout(scroll, 0);
  window.addEventListener("resize", scroll, { once: true });
  setTimeout(() => window.removeEventListener("resize", scroll), 1000);
}

const preventSubmit = (event: FormEvent) => event.preventDefault();

/**
 * The view over the gallery, which stays rendered underneath (still checked, still scrolled where it was). The
 * screen's root is a size container at the full width, as each gallery copy is at its own, and a form of its own
 * (so named radio groups stay apart from the copy underneath).
 */
export function FullScreenLayer({
  specimen,
  place,
  design,
  onAsk,
  onMove,
  onTheme,
  onExit,
}: {
  specimen: LoadedSpecimen;
  place: Place;
  design: Design;
  onAsk: (prefix: string) => void;
  onMove: (position: FlowPosition) => void;
  onTheme: (theme: "light" | "dark") => void;
  onExit: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const screens = flowScreens(specimen);
  const screen = screens.find((item) => item.id === place.position.id) ?? screens[0];
  const go = useCallback((id: string, data?: unknown) => onMove({ id, data }), [onMove]);

  // While it shows, the gallery underneath stands still, focus stays in the view and its bar, and Esc leaves
  // where the browser leaves it to the page (outside the browser's own full screen).
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-basis-fullscreen", true);
    layer.current?.focus({ preventScroll: true });
    const keep = (event: FocusEvent) => {
      if (layer.current && !layer.current.contains(event.target as Node)) layer.current.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onExit();
    };
    document.addEventListener("focusin", keep);
    window.addEventListener("keydown", onKey);
    return () => {
      root.toggleAttribute("data-basis-fullscreen", false);
      document.removeEventListener("focusin", keep);
      window.removeEventListener("keydown", onKey);
    };
  }, [onExit]);

  return (
    <div ref={layer} className={styles.layer} tabIndex={-1} role="region" aria-label={`${specimen.title}, full screen`}>
      <Isolated css={barCss}>
        <Bar
          title={specimen.title}
          screens={screens.map(({ id, label }) => ({ id, label }))}
          current={screen?.id ?? ""}
          theme={place.theme}
          onScreen={(id) => go(id)}
          onTheme={onTheme}
          onExit={onExit}
        />
      </Isolated>
      <form
        className={`ds-root ${previewStyles.root} ${styles.screen}`}
        data-theme={place.theme}
        onSubmit={preventSubmit}
      >
        {screen && (
          <SectionBoundary key={screen.id} name={specimen.title} onAsk={onAsk} report={false}>
            {createElement(screen.render, { design, go, data: place.position.data })}
          </SectionBoundary>
        )}
      </form>
    </div>
  );
}

/**
 * Basis' own controls inside the preview document, in a shadow root: the design's stylesheets (and anything the
 * agent's code puts in the page) cannot reach them, and their styles cannot reach the design.
 */
function Isolated({ css, children }: { css: string; children: ReactNode }) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const host = useCallback((element: HTMLDivElement | null) => {
    if (element) setRoot(element.shadowRoot ?? element.attachShadow({ mode: "open" }));
  }, []);
  return (
    <div ref={host} style={{ display: "contents" }}>
      {root &&
        createPortal(
          <>
            <style>{css}</style>
            {children}
          </>,
          root,
        )}
    </div>
  );
}

/** How near the top edge the pointer brings the bar out, and how far away it lets it go again. */
const REVEAL_PX = 48;
const HIDE_PX = 96;
/** The bar shows for a moment when full screen starts, so it is known to be there. */
const INTRO_MS = 1800;

function Bar({
  title,
  screens,
  current,
  theme,
  onScreen,
  onTheme,
  onExit,
}: {
  title: string;
  screens: { id: string; label: string }[];
  current: string;
  theme: "light" | "dark";
  onScreen: (id: string) => void;
  onTheme: (theme: "light" | "dark") => void;
  onExit: () => void;
}) {
  const [near, setNear] = useState(false);
  const [intro, setIntro] = useState(true);
  const held = useHeld();
  const index = screens.findIndex((screen) => screen.id === current);

  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), INTRO_MS);
    const onPointer = (event: PointerEvent) =>
      setNear((shown) => (shown ? event.clientY <= HIDE_PX : event.clientY <= REVEAL_PX));
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <div className="bar" data-shown={near || intro || undefined} role="toolbar" aria-label="Full screen">
      <span className="title">{title}</span>
      <div className="screens">
        <button
          type="button"
          aria-label="Previous screen"
          disabled={index <= 0}
          onClick={() => onScreen(screens[index - 1]!.id)}
        >
          ‹
        </button>
        <select aria-label="Screen" value={current} onChange={(event) => onScreen(event.target.value)}>
          {screens.map((screen, position) => (
            <option key={screen.id} value={screen.id}>
              {position + 1}. {screen.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Next screen"
          disabled={index === -1 || index >= screens.length - 1}
          onClick={() => onScreen(screens[index + 1]!.id)}
        >
          ›
        </button>
      </div>
      <div className="toggle" role="group" aria-label="Theme">
        {(["light", "dark"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={theme === value} onClick={() => onTheme(value)}>
            {value === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      {held && (
        <span className="held" role="status">
          Changes show when the agent is done
        </span>
      )}
      <button type="button" className="exit" onClick={onExit}>
        Exit <kbd>Esc</kbd>
      </button>
    </div>
  );
}

/** Whether an agent turn holds the preview's changes back (main.tsx marks the document while it does). */
function useHeld(): boolean {
  const root = document.documentElement;
  const [held, setHeld] = useState(() => root.hasAttribute("data-basis-held"));
  useEffect(() => {
    const observer = new MutationObserver(() => setHeld(root.hasAttribute("data-basis-held")));
    observer.observe(root, { attributes: true, attributeFilter: ["data-basis-held"] });
    return () => observer.disconnect();
  }, [root]);
  return held;
}
