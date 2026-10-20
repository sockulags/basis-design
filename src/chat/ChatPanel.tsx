import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Annotation } from "../../shared/annotations.ts";
import {
  AGENT_IDS,
  AGENT_LABELS,
  type AgentId,
  type AgentState,
  type ChatItem,
  type ClientMessage,
  type ThreadSummary,
} from "../../shared/protocol.ts";
import styles from "./ChatPanel.module.css";
import { Composer } from "./Composer.tsx";
import { Markdown } from "./Markdown.tsx";
import { ThreadMenu } from "./ThreadMenu.tsx";
import { describeSummary, groupChat, type ChatBlock, type WorkStep } from "./turns.ts";

const STARTERS = [
  "Calm fintech: deep navy and cool greys, generous whitespace, crisp 6px corners, restrained motion.",
  "Playful consumer app: coral and lime, pill shapes, chunky type, springy transitions.",
  "Editorial: serif display headings, warm paper tones, sharp corners, slow elegant fades.",
  "Dense developer tool: neutral greys, compact 32px controls, mono accents, near-instant feedback.",
];

interface ChatPanelProps {
  agent: AgentState | null;
  /** The project's threads, and the one shown, whose conversation `chat` is. */
  threads: ThreadSummary[];
  thread: string | null;
  chat: ChatItem[];
  connected: boolean;
  /** Validation, type and render problems in the workspace; empty when everything is fine. */
  problems: string[];
  /** Findings of the automatic checks (contrast, accessibility, layout, themes); listed apart, since they do not break anything. */
  checks: string[];
  draft: string;
  onDraft: (text: string) => void;
  send: (message: ClientMessage) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  annotations: Annotation[];
  onRemoveAnnotation: (index: number) => void;
  onClearAnnotations: () => void;
  picking: boolean;
  onTogglePick: () => void;
  /** True while a review is open. */
  reviewing: boolean;
  /** The handle that resizes the panel; inside it, so it belongs to the panel's landmark. */
  resizer?: ReactNode;
}

const STATUS_TEXT: Record<AgentState["status"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Ready",
  busy: "Working",
  error: "Needs attention",
};

export function ChatPanel({
  agent,
  threads,
  thread,
  chat,
  connected,
  problems,
  checks,
  draft,
  onDraft,
  send,
  composerRef,
  resizer,
  ...composer
}: ChatPanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const busy = agent?.status === "busy";
  // The agent may be busy with another thread's turn; this one's messages then wait in the queue.
  const running = threads.some(
    (entry) => entry.id === thread && (entry.status === "working" || entry.status === "waiting"),
  );
  const ready = connected && agent?.status === "ready";
  const sent = chat.flatMap((item) => (item.kind === "user" && !item.auto && item.text ? [item.text] : []));
  const blocks = groupChat(
    chat.filter((item) => !isQueued(item)),
    running,
  );
  const liveWork = blocks.some((block) => block.type === "work" && block.live);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <label className={styles.agentPicker}>
          <span className="visually-hidden">Agent</span>
          <select
            value={agent?.id ?? "claude"}
            onChange={(event) => send({ type: "switch-agent", agent: event.target.value as AgentId })}
            disabled={!connected || busy}
          >
            {AGENT_IDS.map((id) => (
              <option key={id} value={id}>
                {AGENT_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.status} data-status={connected ? agent?.status : "offline"}>
          <span className={styles.statusDot} />
          {connected ? (agent ? STATUS_TEXT[agent.status] : "…") : "Reconnecting"}
        </span>
      </header>
      <ThreadMenu threads={threads} thread={thread} empty={chat.length === 0} connected={connected} send={send} />

      {agent?.status === "error" && (
        <div className={styles.agentError}>
          <p>{agent.detail}</p>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => send({ type: "switch-agent", agent: agent.id })}
          >
            Restart agent
          </button>
        </div>
      )}

      {/* Focusable, so the conversation scrolls from the keyboard too; not role="log", which would read the
          streamed reply aloud as it arrives. */}
      <div
        ref={scroller}
        className={styles.log}
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Describe the feel. The agent builds the system.</p>
            <p className={styles.emptyCopy}>
              Start broad with mood, colour and type, then go deep: "make the button press feel softer", "tighten the
              type scale", "slower, more elegant dialog entrance".
            </p>
            <div className={styles.starters}>
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className={styles.starter}
                  onClick={() => {
                    onDraft(starter);
                    composerRef.current?.focus();
                  }}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          blocks.map((block) =>
            block.type === "work" ? (
              <WorkBlock key={block.id} block={block} />
            ) : (
              <ChatEntry key={block.item.id} item={block.item} send={send} />
            ),
          )
        )}
        {running && !liveWork && <div className={styles.working}>Working on it…</div>}
        {/* Queued messages wait below the running turn, in the order they will run. */}
        {chat.filter(isQueued).map((item) => (
          <ChatEntry key={item.id} item={item} send={send} />
        ))}
      </div>

      {problems.length > 0 && (
        <details className={styles.designErrors}>
          <summary>
            <strong>
              {problems.length} {problems.length === 1 ? "problem" : "problems"} in the workspace.
            </strong>{" "}
            {busy ? "The agent is working on it." : "The agent is asked to fix these after each turn."}
          </summary>
          <ul>
            {problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      )}

      {checks.length > 0 && (
        <details className={styles.checks}>
          <summary>
            <strong>
              {checks.length} {checks.length === 1 ? "finding" : "findings"} from the checks.
            </strong>{" "}
            The agent hears about the ones its changes cause.
          </summary>
          <ul>
            {checks.slice(0, 12).map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.checksAsk}
            onClick={() => {
              onDraft(`Fix these findings:\n${checks.map((check) => `- ${check}`).join("\n")}`);
              composerRef.current?.focus();
            }}
          >
            Ask the agent to fix them
          </button>
        </details>
      )}

      <Composer
        ready={ready}
        busy={busy}
        running={running}
        sent={sent}
        supportsImages={Boolean(agent?.supportsImages)}
        draft={draft}
        onDraft={onDraft}
        composerRef={composerRef}
        send={send}
        onSent={() => {
          pinned.current = true;
        }}
        {...composer}
      />
      {resizer}
    </aside>
  );
}

const isQueued = (item: ChatItem) => item.kind === "user" && item.queued === true;

const TOOL_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◌",
  completed: "✓",
  failed: "✕",
};

/** A long answer shows its first paragraph, and the rest when asked. */
const LONG_ANSWER = 700;

/**
 * One turn's work, folded to a line: what it amounted to, or while it runs, the step in progress. Opened, every
 * step, with the call as it was for a tool whose line says it in fewer words.
 */
function WorkBlock({ block }: { block: Extract<ChatBlock, { type: "work" }> }) {
  const current = block.current;
  const headline =
    block.live && current ? (current.type === "tool" ? current.label : "Thinking") : describeSummary(block.summary);
  return (
    <details className={styles.work} data-live={block.live || undefined}>
      <summary>
        <span className={styles.workIcon} aria-hidden="true">
          {block.live ? "◌" : block.summary.failed ? "!" : "✓"}
        </span>
        <span className={styles.workHeadline}>{headline}</span>
      </summary>
      <ol className={styles.steps}>
        {block.steps.map((step) => (
          <li key={step.id}>
            <Step step={step} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function Step({ step }: { step: WorkStep }) {
  switch (step.type) {
    case "tool": {
      const line = (
        <>
          <span className={styles.stepIcon}>{TOOL_ICON[step.status] ?? "○"}</span>
          <span className={styles.stepLabel}>{step.label}</span>
          {step.count > 1 && <span className={styles.stepCount}>{step.count}×</span>}
        </>
      );
      return step.detail === step.label ? (
        <div className={styles.step} data-status={step.status} title={step.detail}>
          {line}
        </div>
      ) : (
        <details className={styles.stepDetails}>
          <summary className={styles.step} data-status={step.status}>
            {line}
          </summary>
          <pre>{step.detail}</pre>
        </details>
      );
    }
    case "thought":
      return (
        <details className={styles.stepDetails}>
          <summary className={styles.step}>
            <span className={styles.stepIcon}>…</span>
            <span className={styles.stepLabel}>Thought</span>
          </summary>
          <p>{step.text}</p>
        </details>
      );
    case "note":
      return <p className={styles.stepNote}>{step.text}</p>;
    case "allowed":
      return (
        <div className={styles.step} title={step.title}>
          <span className={styles.stepIcon}>✓</span>
          <span className={styles.stepLabel}>
            {step.resolved}: {step.title}
          </span>
        </div>
      );
  }
}

/** The agent's answer: whole when short, else its first paragraph with the rest a click away. */
function Answer({ text }: { text: string }) {
  const split = text.indexOf("\n\n");
  if (text.length < LONG_ANSWER || split === -1) return <Markdown text={text} />;
  return (
    <div className={styles.answer}>
      <Markdown text={text.slice(0, split)} />
      <details className={styles.more}>
        <summary>Show all</summary>
        <Markdown text={text.slice(split + 2)} />
      </details>
    </div>
  );
}

function ChatEntry({ item, send }: { item: ChatItem; send: (message: ClientMessage) => void }) {
  switch (item.kind) {
    case "user":
      return item.auto ? (
        <details className={styles.system}>
          <summary>
            <span className={styles.systemLabel}>Basis asked the agent</span> {item.text.split("\n")[0]}
          </summary>
          <p>{item.text}</p>
        </details>
      ) : (
        <div className={styles.user} data-queued={item.queued || undefined}>
          {item.alternatives && <span className={styles.alternativesLabel}>{item.alternatives} alternatives</span>}
          {item.queued && (
            <span className={styles.queuedLabel}>
              Queued · runs when the agent is done
              <button
                type="button"
                aria-label="Remove from queue"
                onClick={() => send({ type: "unqueue", id: item.id })}
              >
                ×
              </button>
            </span>
          )}
          {item.annotations && (
            <span className={styles.userAttachments}>
              {item.annotations.map((label, index) => (
                <span key={index} className={styles.chip}>
                  <span className={styles.chipIndex}>{index + 1}</span>
                  {label}
                </span>
              ))}
            </span>
          )}
          {item.images && (
            <span className={styles.userAttachments}>
              {item.images.map((src, index) => (
                <span key={index} className={styles.thumb}>
                  <img src={src} alt={`Attachment ${index + 1}`} />
                </span>
              ))}
            </span>
          )}
          {item.text}
        </div>
      );
    case "agent":
      return <Answer text={item.text} />;
    case "thought":
    case "tool":
      // Always inside a turn's work (groupChat).
      return null;
    case "plan":
      return (
        <ol className={styles.plan}>
          {item.entries.map((entry, index) => (
            <li key={index} data-status={entry.status}>
              {entry.content}
            </li>
          ))}
        </ol>
      );
    case "permission":
      return (
        <div className={styles.permission}>
          {/* For a command the title is the command itself: then it is shown once, as code. */}
          <p className={styles.permissionTitle}>
            {item.detail && item.detail === item.title ? "The agent asks to run this" : item.title}
          </p>
          {item.detail && <pre className={styles.permissionDetail}>{item.detail}</pre>}
          {item.resolved ? (
            <p className={styles.permissionResolved}>→ {item.resolved}</p>
          ) : (
            <div className={styles.permissionActions}>
              {item.options.map((option) => (
                <button
                  key={option.optionId}
                  type="button"
                  data-kind={option.kind}
                  onClick={() => send({ type: "permission", id: item.id, optionId: option.optionId })}
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    case "notice":
      return (
        <p className={styles.notice} data-tone={item.tone}>
          {item.text}
        </p>
      );
  }
}
