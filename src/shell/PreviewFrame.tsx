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
  /** The running turn holds changes back from the preview until it ends (server/hold.ts). */
  waiting: boolean;
  /** Every message from the preview, already validated: "ready" when a fresh document loads, then the rest. */
  onMessage: (message: FromPreview) => void;
  /** Full screen ended in the chrome: Esc, or the browser's own controls. */
  onFullScreenEnd: () => void;
}

/**
 * The gallery runs on another origin (port) inside a sandbox, because it
 * executes component code the agent writes. Everything it sends is parsed as
 * untrusted data; it can suggest text for the composer but never act.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function PreviewFrame(
  { port, view, picking, inspecting, waiting, onMessage, onFullScreenEnd },
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

  // Blink mode switches with the B key; pass it on when focus is in the chrome, unless the user is typing.
  const blinking = view.review?.layout === "blink";
  useEffect(() => {
    if (!blinking) return;
    const forward = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if ((event.target as Element).closest?.("input, textarea, select, [contenteditable]")) return;
      post({ type: "blink-key", down: event.type === "keydown" });
    };
    window.addEventListener("keydown", forward);
    window.addEventListener("keyup", forward);
    return () => {
      window.removeEventListener("keydown", forward);
      window.removeEventListener("keyup", forward);
    };
  }, [blinking, post]);

  // A view in full screen: the frame fills the window over the chrome at once, and the browser's full screen takes
  // it over the whole screen where the browser allows (a click in the frame counts for the chrome too). The iframe
  // element is what is in full screen, not its document, so the reload after a turn stays there.
  const full = view.fullscreen !== null;
  const end = useRef(onFullScreenEnd);
  useEffect(() => {
    end.current = onFullScreenEnd;
  });
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    if (full) {
      if (!document.fullscreenElement) element.requestFullscreen?.().catch(() => undefined);
      return;
    }
    if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
  }, [full]);
  useEffect(() => {
    if (!full) return;
    const onChange = () => {
      if (!document.fullscreenElement) end.current();
    };
    // Outside the browser's full screen, Esc is the page's; in the frame the preview handles it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") end.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  return (
    <div
      className={styles.canvas}
      data-inspecting={(inspecting && !full) || undefined}
      data-fullscreen={full || undefined}
    >
      <iframe
        ref={frame}
        className={styles.frame}
        src={src}
        title="Design system preview"
        sandbox="allow-scripts allow-same-origin"
      />
      {waiting && !full && (
        <p className={styles.waiting} role="status">
          Changes show when the agent is done
        </p>
      )}
    </div>
  );
});
