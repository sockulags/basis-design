import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./Shell.module.css";

export const CHAT_DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
/** Always leave this much room for the preview. */
const MIN_PREVIEW = 420;

export function clampChatWidth(width: number): number {
  const max = Math.max(MIN_WIDTH, window.innerWidth - MIN_PREVIEW);
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
}

interface ChatResizerProps {
  width: number;
  onResize: (width: number) => void;
}

/** Vertical splitter between chat and preview: drag, arrow keys, or double-click to reset. */
export function ChatResizer({ width, onResize }: ChatResizerProps) {
  const dragging = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    document.body.dataset.resizing = "true";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onResize(clampChatWidth(event.clientX));
  };

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    delete document.body.dataset.resizing;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") onResize(clampChatWidth(width - step));
    else if (event.key === "ArrowRight") onResize(clampChatWidth(width + step));
    else if (event.key === "Home") onResize(clampChatWidth(0));
    else if (event.key === "End") onResize(clampChatWidth(Infinity));
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onResize(clampChatWidth(CHAT_DEFAULT_WIDTH))}
      onKeyDown={onKeyDown}
    />
  );
}
