import type { Design } from "./design.ts";

/** Messages between the browser and the Basis server over the /bridge WebSocket. */

export const AGENT_IDS = ["claude", "codex"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export type AgentStatus = "stopped" | "starting" | "ready" | "busy" | "error";

export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  /** Human-readable detail for starting/error states. */
  detail?: string;
}

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PermissionChoice {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string; auto?: boolean }
  | { kind: "agent"; id: string; text: string }
  | { kind: "thought"; id: string; text: string }
  | { kind: "tool"; id: string; title: string; toolKind: string; status: ToolStatus }
  | { kind: "plan"; id: string; entries: { content: string; status: string }[] }
  | {
      kind: "permission";
      id: string;
      title: string;
      detail?: string;
      options: PermissionChoice[];
      resolved?: string;
    }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

export interface HistoryEntry {
  id: string;
  at: number;
  source: "init" | "agent" | "revert" | "external";
  name: string;
}

export interface DesignState {
  design: Design;
  /** Validation errors for the file on disk; null when it is valid. The preview keeps the last valid design. */
  errors: string[] | null;
  workspace: string;
}

export type ServerMessage =
  | {
      type: "hello";
      design: DesignState;
      history: HistoryEntry[];
      agent: AgentState;
      chat: ChatItem[];
    }
  | { type: "design"; design: DesignState }
  | { type: "history"; history: HistoryEntry[] }
  | { type: "agent"; agent: AgentState }
  | { type: "chat-upsert"; item: ChatItem }
  | { type: "chat-reset" };

export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "cancel" }
  | { type: "permission"; id: string; optionId: string | null }
  | { type: "new-session" }
  | { type: "switch-agent"; agent: AgentId }
  | { type: "revert"; historyId: string };
