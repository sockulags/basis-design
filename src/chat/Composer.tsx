import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { annotationLabel, type Annotation } from "../../shared/annotations.ts";
import { MAX_IMAGES, type ClientMessage } from "../../shared/protocol.ts";
import { MAX_ALTERNATIVES } from "../../shared/review.ts";
import styles from "./ChatPanel.module.css";
import { imageAttachment, type Attachment } from "./images.ts";

interface ComposerProps {
  ready: boolean;
  /** The agent runs a turn, in this thread or another: a message is queued. */
  busy: boolean;
  /** The turn running is this thread's, so Stop stops it. */
  running: boolean;
  /** Earlier prompts, oldest first, for recalling with the arrow keys. */
  sent: string[];
  /** True while a review is open; every message is part of it. */
  reviewing: boolean;
  supportsImages: boolean;
  draft: string;
  onDraft: (text: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  annotations: Annotation[];
  onRemoveAnnotation: (index: number) => void;
  onClearAnnotations: () => void;
  picking: boolean;
  onTogglePick: () => void;
  send: (message: ClientMessage) => void;
  onSent: () => void;
}

export function Composer({
  ready,
  busy,
  running,
  sent,
  reviewing,
  supportsImages,
  draft,
  onDraft,
  composerRef,
  annotations,
  onRemoveAnnotation,
  onClearAnnotations,
  picking,
  onTogglePick,
  send,
  onSent,
}: ComposerProps) {
  const [images, setImages] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** How many takes the next message asks for; back to one after sending, since more cost more. */
  const [alternatives, setAlternatives] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Position in `sent` while recalling earlier prompts; null while typing a new one. */
  const recall = useRef<number | null>(null);
  const hasContent = Boolean(draft.trim() || images.length || annotations.length);
  // While the agent works, a message is queued and runs when the current turn ends.
  const canSend = (ready || busy) && hasContent;

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft, composerRef]);

  const addFiles = async (files: Iterable<File>) => {
    if (!supportsImages) {
      setNotice("This agent does not accept images.");
      return;
    }
    const added: Attachment[] = [];
    for (const file of files) {
      const attachment = await imageAttachment(file);
      if (attachment) added.push(attachment);
    }
    setImages((current) => {
      const next = [...current, ...added];
      setNotice(next.length > MAX_IMAGES ? `Up to ${MAX_IMAGES} images per message.` : null);
      return next.slice(0, MAX_IMAGES);
    });
  };

  const submit = () => {
    if (!canSend) return;
    recall.current = null;
    send({
      type: "prompt",
      text: draft.trim(),
      images: images.map(({ mimeType, data }) => ({ mimeType, data })),
      annotations,
      alternatives: alternatives > 1 ? alternatives : undefined,
    });
    setAlternatives(1);
    onDraft("");
    setImages([]);
    setNotice(null);
    onClearAnnotations();
    onSent();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
      return;
    }
    // Up and Down walk through earlier prompts, like a shell, when the composer is empty or showing one.
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && !event.altKey && sent.length > 0) {
      const index = recall.current;
      const showingRecalled = index !== null && draft === sent[index];
      if (draft && !showingRecalled) return;
      const next =
        event.key === "ArrowUp" ? Math.max(0, (index ?? sent.length) - 1) : index === null ? null : index + 1;
      event.preventDefault();
      if (next === null || next >= sent.length) {
        recall.current = null;
        onDraft("");
      } else {
        recall.current = next;
        onDraft(sent[next]!);
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  return (
    <form
      className={styles.composer}
      data-dragging={dragging || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {(annotations.length > 0 || images.length > 0) && (
        <div className={styles.attachments}>
          {annotations.map((annotation, index) => (
            <span key={index} className={styles.chip} title={annotation.tokenPath ?? annotation.section}>
              <span className={styles.chipIndex}>{index + 1}</span>
              {annotationLabel(annotation)}
              <button
                type="button"
                aria-label={`Remove ${annotationLabel(annotation)}`}
                onClick={() => onRemoveAnnotation(index)}
              >
                ×
              </button>
            </span>
          ))}
          {images.map((image) => (
            <span key={image.id} className={styles.thumb}>
              <img src={image.preview} alt="" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={composerRef}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={
          ready || busy
            ? alternatives > 1
              ? `Describe the change; the agent makes ${alternatives} alternatives to choose between…`
              : annotations.length
                ? "What should change? Refer to picks as [1], [2]…"
                : reviewing
                  ? "Tell the agent what to change in this review…"
                  : busy
                    ? "Type the next step; it runs when the agent is done…"
                    : "Describe a change, paste a screenshot, or pick an element…"
            : "Waiting for the agent…"
        }
        rows={2}
      />
      {notice && <p className={styles.composerNotice}>{notice}</p>}
      <div className={styles.composerBar}>
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.tool}
            aria-pressed={picking}
            onClick={onTogglePick}
            title="Pick a component in the preview and attach it"
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
              <circle cx="8" cy="8" r="3.5" />
            </svg>
            Pick
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={() => fileInput.current?.click()}
            disabled={!supportsImages}
            title={supportsImages ? "Attach images (or paste / drop them)" : "This agent does not accept images"}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5" />
              <circle cx="10.5" cy="6" r="1" />
            </svg>
            Image
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        <div className={styles.sendGroup}>
          <div className={styles.count} role="group" aria-label="Alternatives">
            {Array.from({ length: MAX_ALTERNATIVES }, (_, index) => index + 1).map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={alternatives === count}
                onClick={() => setAlternatives(count)}
                title={count === 1 ? "One version" : `${count} alternatives side by side, to pick one from`}
              >
                ×{count}
              </button>
            ))}
          </div>
          {running && (
            <button
              type="button"
              className={styles.stop}
              onClick={() => send({ type: "cancel" })}
              title="Stop the agent and drop the messages queued in this chat"
            >
              Stop
            </button>
          )}
          {(!running || hasContent) && (
            <button
              type="submit"
              className={styles.send}
              disabled={!canSend}
              title={busy ? "Runs when the agent is done" : undefined}
            >
              {busy ? "Queue" : "Send"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
