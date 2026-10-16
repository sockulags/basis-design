import type { Annotation } from "./annotations.ts";
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
  /** Whether the running agent accepts image content in prompts. */
  supportsImages?: boolean;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_IMAGES = 6;
/** Base64 length cap per image (~5 MB decoded). */
export const MAX_IMAGE_BASE64 = 7_000_000;

export interface PromptImage {
  mimeType: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PermissionChoice {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export type ChatItem =
  | {
      kind: "user";
      id: string;
      text: string;
      auto?: boolean;
      /** data: URLs of attached images, for display. */
      images?: string[];
      /** Labels of attached annotations, in order. */
      annotations?: string[];
    }
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
  /** The prompt behind an agent change, or what a restore went back to. */
  label?: string;
  /** For restores: the entry whose design was restored. */
  restoredFrom?: string;
  /** Token paths that differ from the previous entry. */
  changed: string[];
  /** Component files (relative to the workspace) changed in this entry. */
  files: string[];
}

/** A past version fetched for inspection. */
export interface Snapshot {
  id: string;
  design: Design;
  /** Component files that differ between that version and now. */
  files: string[];
  /** Unified diff from now to that version, limited to components/. */
  codeDiff: string;
}

/** One file of the exported starter kit, path relative to the kit folder. */
export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportWriteResult {
  ok: boolean;
  /** Absolute folder the kit was (or would have been) written to. */
  target: string;
  written: string[];
  /** Existing files that would change; nothing is written until the user confirms. */
  conflicts: string[];
  error?: string;
}

export interface DesignState {
  design: Design;
  /** Validation errors for the file on disk; null when it is valid. The preview keeps the last valid design. */
  errors: string[] | null;
  /** Type errors in components/ (including broken contracts); null when clean. */
  typeErrors: string[] | null;
  workspace: string;
}

export type ServerMessage =
  | {
      type: "hello";
      /** Port of the sandboxed preview origin. */
      previewPort: number;
      design: DesignState;
      history: HistoryEntry[];
      agent: AgentState;
      chat: ChatItem[];
    }
  | { type: "design"; design: DesignState }
  | { type: "history"; history: HistoryEntry[] }
  | { type: "agent"; agent: AgentState }
  | { type: "chat-upsert"; item: ChatItem }
  | { type: "chat-reset" }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "export-manifest"; folder: string; files: { path: string; bytes: number }[] }
  | { type: "export-result"; result: ExportWriteResult };

export type ClientMessage =
  | { type: "prompt"; text: string; images?: PromptImage[]; annotations?: Annotation[] }
  | { type: "cancel" }
  | { type: "permission"; id: string; optionId: string | null }
  | { type: "new-session" }
  | { type: "switch-agent"; agent: AgentId }
  | { type: "revert"; historyId: string }
  | { type: "snapshot-get"; id: string }
  /** Render errors the preview currently shows (empty when it renders cleanly). */
  | { type: "preview-errors"; errors: string[] }
  | { type: "export-manifest" }
  | { type: "export-write"; target: string; overwrite: boolean };
