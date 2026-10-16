import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { AGENT_IDS, AGENT_LABELS, type AgentId, type AgentState, type ChatItem, type ClientMessage } from "../../shared/protocol.ts";
import styles from "./ChatPanel.module.css";
import { Markdown } from "./Markdown.tsx";

const STARTERS = [
  "Calm fintech: deep navy and cool greys, generous whitespace, crisp 6px corners, restrained motion.",
  "Playful consumer app: coral and lime, pill shapes, chunky type, springy transitions.",
  "Editorial: serif display headings, warm paper tones, sharp corners, slow elegant fades.",
  "Dense developer tool: neutral greys, compact 32px controls, mono accents, near-instant feedback.",
];

interface ChatPanelProps {
  agent: AgentState | null;
  chat: ChatItem[];
  connected: boolean;
  designErrors: string[] | null;
  draft: string;
  onDraft: (text: string) => void;
  send: (message: ClientMessage) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

const STATUS_TEXT: Record<AgentState["status"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Ready",
  busy: "Working",
  error: "Needs attention",
};

export function ChatPanel({ agent, chat, connected, designErrors, draft, onDraft, send, composerRef }: ChatPanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const busy = agent?.status === "busy";
  const ready = connected && agent?.status === "ready";

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft, composerRef]);

  const submit = () => {
    const text = draft.trim();
    if (!text || !ready) return;
    send({ type: "prompt", text });
    onDraft("");
    pinned.current = true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

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
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => send({ type: "new-session" })}
          disabled={!connected || chat.length === 0}
          title="Start a new conversation (the design stays)"
        >
          New chat
        </button>
      </header>

      {agent?.status === "error" && (
        <div className={styles.agentError}>
          <p>{agent.detail}</p>
          <button type="button" className={styles.iconButton} onClick={() => send({ type: "switch-agent", agent: agent.id })}>
            Restart agent
          </button>
        </div>
      )}

      <div
        ref={scroller}
        className={styles.log}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Describe the feel. The agent builds the system.</p>
            <p className={styles.emptyCopy}>
              Start broad with mood, colour and type, then go deep: "make the button press feel softer", "tighten the type
              scale", "slower, more elegant dialog entrance".
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
          chat.map((item) => <ChatEntry key={item.id} item={item} send={send} />)
        )}
        {busy && <div className={styles.working}>Working on it…</div>}
      </div>

      {designErrors && (
        <div className={styles.designErrors}>
          <strong>design-system.json has errors.</strong> The preview shows the last valid version.
          <ul>
            {designErrors.slice(0, 4).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ready || busy ? "Describe a change…" : "Waiting for the agent…"}
          rows={2}
        />
        <div className={styles.composerBar}>
          <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
          {busy ? (
            <button type="button" className={styles.stop} onClick={() => send({ type: "cancel" })}>
              Stop
            </button>
          ) : (
            <button type="submit" className={styles.send} disabled={!ready || !draft.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

const TOOL_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◌",
  completed: "✓",
  failed: "✕",
};

function ChatEntry({ item, send }: { item: ChatItem; send: (message: ClientMessage) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <div className={styles.user} data-auto={item.auto || undefined}>
          {item.auto && <span className={styles.autoLabel}>Basis → agent</span>}
          {item.text}
        </div>
      );
    case "agent":
      return <Markdown text={item.text} />;
    case "thought":
      return (
        <details className={styles.thought}>
          <summary>Thinking</summary>
          <p>{item.text}</p>
        </details>
      );
    case "tool":
      return (
        <div className={styles.tool} data-status={item.status}>
          <span className={styles.toolIcon}>{TOOL_ICON[item.status] ?? "○"}</span>
          <span className={styles.toolTitle}>{item.title}</span>
        </div>
      );
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
          <p className={styles.permissionTitle}>{item.title}</p>
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
