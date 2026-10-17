import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { parseFromPreview, type FromPreview, type PreviewView, type ToPreview } from "../../shared/frame.ts";
import styles from "./Shell.module.css";

export interface PreviewFrameHandle {
  scrollTo: (id: string) => void;
  removePick: (index: number) => void;
  clearPicks: () => void;
}

interface PreviewFrameProps {
  port: number;
  /** What the preview shows; sent again whenever it changes and to every fresh preview document. */
  view: PreviewView;
  picking: boolean;
  inspecting: boolean;
  /** Every message from the preview, already validated: "ready" when a fresh document loads, then the rest. */
  onMessage: (message: FromPreview) => void;
}

/**
 * The gallery runs on another origin (port) inside a sandbox, because it
 * executes component code the agent writes. Everything it sends is parsed as
 * untrusted data; it can suggest text for the composer but never act.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function PreviewFrame(
  { port, view, picking, inspecting, onMessage },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  /** Counts "ready" messages; every fresh preview document needs the current state sent again. */
  const [generation, setGeneration] = useState(0);
  const previewOrigin = `${location.protocol}//${location.hostname}:${port}`;
  const src = `${previewOrigin}/preview.html?parent=${encodeURIComponent(location.origin)}`;

  const post = useCallback(
    (message: ToPreview) => frame.current?.contentWindow?.postMessage(message, previewOrigin),
    [previewOrigin],
  );

  useImperativeHandle(ref, () => ({
    scrollTo: (id) => post({ type: "scroll-to", id }),
    removePick: (index) => post({ type: "picks-remove", index }),
    clearPicks: () => post({ type: "picks-clear" }),
  }));

  // The latest handler without re-subscribing the listener on every render.
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== previewOrigin) return;
      const message = parseFromPreview(event.data);
      if (!message) return;
      if (message.type === "ready") setGeneration((value) => value + 1);
      handler.current(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [previewOrigin]);

  useEffect(() => {
    if (generation > 0) post({ type: "render", view });
  }, [generation, view, post]);

  useEffect(() => {
    if (generation > 0) post({ type: "picking", on: picking });
  }, [generation, picking, post]);

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
