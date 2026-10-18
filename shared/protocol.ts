import type { Annotation } from "./annotations.ts";
import type { Design } from "./design.ts";
import type { PageId } from "./frame.ts";
import type { ReviewState } from "./review.ts";

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
      /** Sent while the agent was busy; runs when the current turn ends. */
      queued?: boolean;
      /** Asked for this many alternatives to choose between. */
      alternatives?: number;
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
  source: "init" | "agent" | "revert" | "external" | "review";
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
  /** Type errors in the source folders (including broken or missing contracts); null when clean. */
  typeErrors: string[] | null;
  /** Problems with review.json; null when it is valid or absent. */
  reviewErrors: string[] | null;
  workspace: string;
}

/** A past version materialised for a review: its tokens, and where the preview can import its source. */
export interface Baseline {
  id: string;
  design: Design;
  /** URL path on the preview origin of the folder holding that version's components/ and patterns/. */
  base: string;
}

/** A project: one workspace folder with its own design system, history, chat and review. */
export interface ProjectEntry {
  id: string;
  name: string;
  /** Absolute path of the workspace folder. */
  dir: string;
  /** Absolute path of a product repo the project designs for; the agent may read it, never write to it. */
  repo?: string;
}

export type ServerMessage =
  | {
      /** Everything about the open project; sent on connect and again after switching projects. */
      type: "hello";
      /** Port of the sandboxed preview origin. */
      previewPort: number;
      project: ProjectEntry;
      projects: ProjectEntry[];
      design: DesignState;
      history: HistoryEntry[];
      agent: AgentState;
      chat: ChatItem[];
      review: ReviewState | null;
    }
  | { type: "projects"; projects: ProjectEntry[] }
  /** A project is being opened; a hello for it follows. */
  | { type: "project-switching"; project: ProjectEntry }
  /** Why a project request could not be done, for the dialog that made it. */
  | { type: "project-error"; message: string }
  | { type: "review"; review: ReviewState | null }
  | { type: "baseline"; baseline: Baseline }
  | { type: "design"; design: DesignState }
  | { type: "history"; history: HistoryEntry[] }
  | { type: "agent"; agent: AgentState }
  | { type: "chat-upsert"; item: ChatItem }
  | { type: "chat-reset" }
  | { type: "chat-remove"; id: string }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "export-manifest"; folder: string; files: { path: string; bytes: number }[] }
  | { type: "export-result"; result: ExportWriteResult };

export type ClientMessage =
  /** With `alternatives` (2 or 3), the agent makes that many takes on the prompt to choose between. */
  | { type: "prompt"; text: string; images?: PromptImage[]; annotations?: Annotation[]; alternatives?: number }
  /** Asks the agent to create a new component or pattern (decided by the page) in a guided turn. */
  | { type: "create"; page: PageId; name: string; purpose: string }
  | { type: "cancel" }
  | { type: "permission"; id: string; optionId: string | null }
  | { type: "new-session" }
  | { type: "switch-agent"; agent: AgentId }
  | { type: "revert"; historyId: string }
  | { type: "snapshot-get"; id: string }
  | { type: "baseline-get"; id: string }
  /** Ends the open review with one history entry for everything it changed. */
  | { type: "review-approve" }
  /** Ends the open review and puts everything back as it was when it started. */
  | { type: "review-discard" }
  /** Goes back to an earlier iteration of the open review (recorded as a new iteration). */
  | { type: "review-step"; id: string }
  /** Continues the open review with one of its alternatives. */
  | { type: "review-choose"; label: string }
  /** Removes a queued prompt before it runs. */
  | { type: "unqueue"; id: string }
  /**
   * Render errors this tab's preview currently shows (empty when it renders cleanly), the findings of its
   * automatic checks, and whether the tab is visible: with several tabs open, the fix loop listens to the one
   * the user looks at.
   */
  | { type: "preview-errors"; errors: string[]; visible: boolean; checks?: string[]; checking?: boolean }
  | { type: "export-manifest" }
  | { type: "export-write"; target: string; overwrite: boolean }
  | { type: "project-switch"; id: string }
  /** Creates a project from Basis' defaults, or as a copy of the open project's design system, and opens it. */
  | { type: "project-create"; name: string; copyCurrent: boolean }
  /** Adds a workspace folder (or an empty or new one) to the list and opens it. */
  | { type: "project-open"; dir: string }
  | { type: "project-remove"; id: string }
  /** Links a product repo folder to a project, or unlinks it (null). */
  | { type: "project-repo"; id: string; repo: string | null };
