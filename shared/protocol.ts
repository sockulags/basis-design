import type { Annotation } from "./annotations.ts";
import type { Design } from "./design.ts";
import type { PageId } from "./frame.ts";
import type { ReviewState } from "./review.ts";

/** Messages between the browser and the Basis server over the /bridge WebSocket. */

export const AGENT_IDS = ["claude", "codex"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Names in the agent picker. Anthropic's branding rules allow "Claude" in a menu labelled Agent, not "Claude Code". */
export const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude",
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

/**
 * What a thread is up to, for the list of threads: its turn runs, waits for an answer to a permission request, or
 * waits in the queue behind another thread's turn (turns take turns across threads). Idle threads have none.
 */
export type ThreadStatus = "working" | "waiting" | "queued";

/** One thread of a project: a chat of its own with its own agent session, in the same workspace. */
export interface ThreadSummary {
  id: string;
  /** From its first prompt; "New chat" until then. */
  title: string;
  /** When a turn last started in it (or it was made), for the list. */
  at: number;
  status?: ThreadStatus;
}

export interface HistoryEntry {
  id: string;
  at: number;
  /** `upgrade` is Basis bringing an older workspace up to date (files it added since), which Undo never removes. */
  source: "init" | "agent" | "revert" | "external" | "review" | "upgrade";
  name: string;
  /** The prompt behind an agent change, or what a restore went back to. */
  label?: string;
  /** For restores: the entry whose design was restored. */
  restoredFrom?: string;
  /** For agent changes: the title of the thread whose turn it was. */
  thread?: string;
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

/** What a finished verification kit holds, for the Export dialog to report. */
export interface VerifyKitSummary {
  /** The browser that took the screenshots, with its version. */
  browser: string;
  views: number;
  /** The views in the kit, for the prompt the user copies for the implementing agent. */
  viewList: { id: string; title: string }[];
  screens: number;
  shots: number;
  /** Shots whose two captures differed: those screens do not render the same twice. */
  unstable: string[];
  /** Shots of screens that threw while rendering. */
  failed: string[];
  /** Shots of screens that load images or media from other sites. */
  remote: string[];
  /** Specimen files that could not be loaded. */
  problems: string[];
}

export type VerifyKitResult =
  | {
      ok: true;
      summary: VerifyKitSummary;
      /** Where it was written; absent for a zip, which is then ready to download. */ dir?: string;
      /** The skill installed in the product repo, when asked for; `written` is false when one not by Basis was kept. */
      skill?: { file: string; written: boolean };
    }
  | { ok: false; error: string };

export interface DesignState {
  design: Design;
  /** Validation errors for the file on disk; null when it is valid. The preview keeps the last valid design. */
  errors: string[] | null;
  /** Type errors in the source folders (including broken or missing contracts); null when clean. */
  typeErrors: string[] | null;
  /** Problems with review.json; null when it is valid or absent. */
  reviewErrors: string[] | null;
  /** Colours in tokens and stylesheets that stay the same in both themes (see shared/fixed-colors.ts). */
  colorFindings: string[];
  workspace: string;
  /** A newer starter template whose changes the agent can bring into this workspace; null when caught up. */
  templateUpdate: TemplateUpdate | null;
}

/** A newer starter template the workspace has not caught up with (see server/template.ts). */
export interface TemplateUpdate {
  /** The template version the workspace last caught up with (0: before versions were recorded). */
  from: number;
  to: number;
  /** Starter files the workspace has changed, which differ from the current template. */
  files: string[];
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

/**
 * What a project open in the background is up to, for the project menu: its agent works, waits for an answer to a
 * permission request, or finished a turn nobody has looked at yet. Projects with none of these have no status.
 */
export type ProjectStatus = "working" | "waiting" | "done";

/**
 * A message on the bridge with the project it belongs to. Several projects run at once, and a tab shows one: the
 * server tags each project's messages with its id, so a tab that has moved on drops them, and the chrome tags what it
 * sends with the project it showed, so a message sent just before a switch still reaches that project. The chrome
 * also names the thread it shows, which a prompt goes to.
 */
export type Tagged<T> = T & { projectId?: string; thread?: string };

export type ServerMessage =
  | {
      /** Everything about the project this tab shows; sent on connect and again after switching projects. */
      type: "hello";
      /** Port of the sandboxed preview origin. */
      previewPort: number;
      project: ProjectEntry;
      projects: ProjectEntry[];
      design: DesignState;
      history: HistoryEntry[];
      agent: AgentState;
      /** The project's threads, and the one this tab shows, whose chat follows. */
      threads: ThreadSummary[];
      thread: string;
      chat: ChatItem[];
      review: ReviewState | null;
      /** Whether the running turn holds changes back from the preview (see "preview-waiting"). */
      previewWaiting: boolean;
      /** What the projects in the background are up to, by id. */
      status: Record<string, ProjectStatus>;
    }
  | { type: "projects"; projects: ProjectEntry[] }
  /** What the projects are up to changed (see ProjectStatus); sent to every tab. */
  | { type: "project-status"; status: Record<string, ProjectStatus> }
  /** A project is being opened; a hello for it follows. */
  | { type: "project-switching"; project: ProjectEntry }
  /** Why a project request could not be done, for the dialog that made it. */
  | { type: "project-error"; message: string }
  | { type: "review"; review: ReviewState | null }
  | { type: "baseline"; baseline: Baseline }
  | { type: "design"; design: DesignState }
  /** The running turn changed what the preview shows, which it shows once the turn ends (server/hold.ts); false then. */
  | { type: "preview-waiting"; waiting: boolean }
  | { type: "history"; history: HistoryEntry[] }
  | { type: "agent"; agent: AgentState }
  /** A thread's chat changed; a tab that shows another thread of the project drops it. */
  | { type: "chat-upsert"; thread: string; item: ChatItem }
  | { type: "chat-remove"; thread: string; id: string }
  /** The project's threads changed: one was made or removed, got its title, or started or stopped working. */
  | { type: "threads"; threads: ThreadSummary[] }
  /** Shows a thread in this tab, with its chat (the answer to thread-new and thread-open). */
  | { type: "thread"; thread: string; chat: ChatItem[] }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "export-manifest"; folder: string; files: { path: string; bytes: number }[] }
  | { type: "export-result"; result: ExportWriteResult }
  /** How far the verification kit has come; `done`/`total` while it takes screenshots. */
  | { type: "verify-progress"; step: string; done?: number; total?: number }
  | { type: "verify-result"; result: VerifyKitResult };

export type ClientMessage =
  /** With `alternatives` (2 or 3), the agent makes that many takes on the prompt to choose between. */
  | { type: "prompt"; text: string; images?: PromptImage[]; annotations?: Annotation[]; alternatives?: number }
  /** Asks the agent to create a new component or pattern (decided by the page) in a guided turn. */
  | { type: "create"; page: PageId; name: string; purpose: string }
  | { type: "cancel" }
  | { type: "permission"; id: string; optionId: string | null }
  /** Starts a new thread (a chat with a session of its own) and shows it; an empty thread there is reused. */
  | { type: "thread-new" }
  /** Shows one of the project's threads in this tab. */
  | { type: "thread-open"; id: string }
  /** Removes a thread and its conversation; refused while it works, waits, is queued or a tab shows it. */
  | { type: "thread-remove"; id: string }
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
   * the user looks at. `generation` is the preview document's (see shared/hold.ts), so the fix loop can wait for a
   * report from the gallery reloaded after a turn.
   */
  | {
      type: "preview-errors";
      errors: string[];
      visible: boolean;
      checks?: string[];
      checking?: boolean;
      generation?: number;
    }
  | { type: "export-manifest" }
  | { type: "export-write"; target: string; overwrite: boolean }
  /**
   * Builds the verification kit: into `<project>/basis-verify/` with `project`, else as a zip to download. With
   * `skill`, writing into a folder also installs the kit's SKILL.md in its `.claude/skills/basis-verify/`.
   */
  | { type: "verify-kit"; project?: string; skill?: boolean }
  /** Shows another project in this tab; the one it showed goes on in the background. */
  | { type: "project-switch"; id: string }
  /** Creates a project from Basis' defaults, or as a copy of the open project's design system, and opens it. */
  /**
   * With `repo`, the new project links that product repo and starts by bringing in its design system; the name
   * may then be empty (the repo folder's name is used).
   */
  | { type: "project-create"; name: string; copyCurrent: boolean; repo?: string }
  /** Adds a workspace folder (or an empty or new one) to the list and opens it. */
  | { type: "project-open"; dir: string }
  | { type: "project-remove"; id: string }
  /**
   * Links a product repo folder to a project, or unlinks it (null). With `bringIn`, linking the open project's
   * repo also starts the guided turn that brings in its design system.
   */
  | { type: "project-repo"; id: string; repo: string | null; bringIn?: boolean }
  /** Starts the guided turn that brings the open project's product repo design system into the workspace. */
  | { type: "import-design" }
  /** Starts the guided turn that brings the newer starter template's changes into the workspace. */
  | { type: "template-update" }
  /** Marks the newer template as seen without bringing its changes in. */
  | { type: "template-skip" };
