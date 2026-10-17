import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Annotation } from "../../shared/annotations.ts";
import type { Design } from "../../shared/design.ts";
import { parseFromPreview, type NavSection, type PageId, type ReviewView, type ToPreview } from "../../shared/frame.ts";
import styles from "./Shell.module.css";

export interface PreviewFrameHandle {
  scrollTo: (id: string) => void;
  removePick: (index: number) => void;
  clearPicks: () => void;
}

interface PreviewFrameProps {
  port: number;
  design: Design;
  theme: "light" | "dark";
  page: PageId;
  review: ReviewView | null;
  picking: boolean;
  inspecting: boolean;
  onPicks: (annotations: Annotation[]) => void;
  onPickingEnd: () => void;
  onAsk: (prefix: string) => void;
  onImpact: (ids: string[]) => void;
  onActiveSection: (id: string) => void;
  onErrors: (errors: string[]) => void;
  onSections: (sections: NavSection[]) => void;
}

/**
 * The gallery runs on another origin (port) inside a sandbox, because it
 * executes component code the agent writes. Everything it sends is parsed as
 * untrusted data; it can suggest text for the composer but never act.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function PreviewFrame(
  {
    port,
    design,
    theme,
    page,
    review,
    picking,
    inspecting,
    onPicks,
    onPickingEnd,
    onAsk,
    onImpact,
    onActiveSection,
    onErrors,
    onSections,
  },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  /** Counts "ready" messages; every fresh preview document needs the current state sent again. */
  const [generation, setGeneration] = useState(0);
  const previewOrigin = `${location.protocol}//${location.hostname}:${port}`;
  const src = `${previewOrigin}/preview.html?parent=${encodeURIComponent(location.origin)}`;

  const post = (message: ToPreview) => frame.current?.contentWindow?.postMessage(message, previewOrigin);

  useImperativeHandle(ref, () => ({
    scrollTo: (id) => post({ type: "scroll-to", id }),
    removePick: (index) => post({ type: "picks-remove", index }),
    clearPicks: () => post({ type: "picks-clear" }),
  }));

  // Latest callbacks without re-subscribing the listener on every render.
  const handlers = useRef({ onPicks, onPickingEnd, onAsk, onImpact, onActiveSection, onErrors, onSections });
  handlers.current = { onPicks, onPickingEnd, onAsk, onImpact, onActiveSection, onErrors, onSections };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== previewOrigin) return;
      const message = parseFromPreview(event.data);
      if (!message) return;
      const h = handlers.current;
      switch (message.type) {
        case "ready":
          // A fresh document (first load or a full reload after an edit) starts without picks.
          setGeneration((value) => value + 1);
          h.onPicks([]);
          return;
        case "active-section":
          return h.onActiveSection(message.id);
        case "ask":
          return h.onAsk(message.prefix);
        case "impact":
          return h.onImpact(message.ids);
        case "picks":
          return h.onPicks(message.annotations);
        case "picking":
          if (!message.on) h.onPickingEnd();
          return;
        case "errors":
          return h.onErrors(message.errors);
        case "sections":
          return h.onSections(message.sections);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewOrigin]);

  useEffect(() => {
    if (generation > 0) post({ type: "render", design, theme, page, review });
  }, [generation, design, theme, page, review]);

  useEffect(() => {
    if (generation > 0) post({ type: "picking", on: picking });
  }, [generation, picking]);

  return (
    <div className={styles.canvas} data-inspecting={inspecting || undefined}>
      <iframe
        ref={frame}
        className={styles.frame}
        src={src}
        title="Design system preview"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
});
