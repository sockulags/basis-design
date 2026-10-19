import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  AgentState,
  Baseline,
  ChatItem,
  ClientMessage,
  DesignState,
  HistoryEntry,
  ExportWriteResult,
  ProjectEntry,
  ProjectStatus,
  ServerMessage,
  Snapshot,
  Tagged,
  ThreadSummary,
  VerifyKitResult,
} from "../shared/protocol.ts";
import type { ReviewState } from "../shared/review.ts";
import { DEFAULT_WIDTHS, type Widths } from "../shared/widths.ts";

export interface BridgeState {
  connected: boolean;
  /** The open project, and every project on the list. */
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  /** What the projects in the background are up to, by id (see ProjectStatus). */
  status: Record<string, ProjectStatus>;
  /** The project being opened, while Basis switches to it. */
  switching: ProjectEntry | null;
  /** Why the last project request failed, until the next one. */
  /** The last failed project request's answer; a new object each time, so a repeated message is a new answer. */
  projectError: { message: string } | null;
  design: DesignState | null;
  history: HistoryEntry[];
  agent: AgentState | null;
  /** The project's threads, and the one this tab shows, whose chat `chat` is. */
  threads: ThreadSummary[];
  thread: string | null;
  chat: ChatItem[];
  /** History snapshots fetched for inspection, by entry id. */
  snapshots: Record<string, Snapshot>;
  /** The open review, if any. */
  review: ReviewState | null;
  /** Past versions materialised for reviews, by commit id. */
  baselines: Record<string, Baseline>;
  /** Port of the sandboxed preview origin, from the server. */
  previewPort: number | null;
  /** The running turn changed what the preview shows, which it shows once the turn ends. */
  previewWaiting: boolean;
  /** The project's widths for Mobile, Tablet and Desktop. */
  widths: Widths;
  exportManifest: { folder: string; files: { path: string; bytes: number }[] } | null;
  exportResult: ExportWriteResult | null;
  /** The verification kit being built (its current step), or null. */
  verifyProgress: { step: string; done?: number; total?: number } | null;
  verifyResult: VerifyKitResult | null;
}

const initial: BridgeState = {
  connected: false,
  project: null,
  projects: [],
  status: {},
  switching: null,
  projectError: null,
  design: null,
  history: [],
  agent: null,
  threads: [],
  thread: null,
  chat: [],
  snapshots: {},
  review: null,
  baselines: {},
  previewPort: null,
  previewWaiting: false,
  widths: DEFAULT_WIDTHS,
  exportManifest: null,
  exportResult: null,
  verifyProgress: null,
  verifyResult: null,
};

type Action = Tagged<ServerMessage> | { type: "connected"; connected: boolean; projectId?: undefined };

function reduce(state: BridgeState, action: Action): BridgeState {
  // A message of another project than the one this tab shows (the one it just left) is not for it.
  if (action.type !== "hello" && action.projectId !== undefined && action.projectId !== state.project?.id) return state;
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected };
    case "hello": {
      // A hello for another project replaces everything that belonged to the previous one.
      const same = state.project?.id === action.project.id;
      return {
        ...(same ? state : { ...initial, projectError: state.projectError }),
        connected: true,
        project: action.project,
        projects: action.projects,
        status: action.status,
        switching: null,
        previewPort: action.previewPort,
        design: action.design,
        history: action.history,
        agent: action.agent,
        threads: action.threads,
        thread: action.thread,
        chat: action.chat,
        review: action.review,
        previewWaiting: action.previewWaiting,
        widths: action.widths,
        // The server may have restarted and removed its copies of past versions; ask for them again.
        baselines: {},
      };
    }
    case "projects":
      // The open project's entry can change too (a product repo linked).
      return {
        ...state,
        projects: action.projects,
        project: action.projects.find((entry) => entry.id === state.project?.id) ?? state.project,
      };
    case "project-status":
      return { ...state, status: action.status };
    case "project-switching":
      return { ...state, switching: action.project, projectError: null };
    case "project-error":
      return { ...state, projectError: { message: action.message } };
    case "design":
      return { ...state, design: action.design };
    case "preview-waiting":
      return { ...state, previewWaiting: action.waiting };
    case "widths":
      return { ...state, widths: action.widths };
    case "history":
      return { ...state, history: action.history };
    case "agent":
      return { ...state, agent: action.agent };
    case "threads":
      return { ...state, threads: action.threads };
    case "thread":
      return { ...state, thread: action.thread, chat: action.chat };
    case "chat-upsert": {
      // Another thread's chat is not the one this tab shows.
      if (action.thread !== state.thread) return state;
      const index = state.chat.findIndex((item) => item.id === action.item.id);
      if (index === -1) return { ...state, chat: [...state.chat, action.item] };
      const chat = state.chat.slice();
      chat[index] = action.item;
      return { ...state, chat };
    }
    case "export-manifest":
      return { ...state, exportManifest: { folder: action.folder, files: action.files } };
    case "export-result":
      return { ...state, exportResult: action.result };
    case "verify-progress":
      return { ...state, verifyProgress: { step: action.step, done: action.done, total: action.total } };
    case "verify-result":
      return { ...state, verifyProgress: null, verifyResult: action.result };
    case "review":
      // A review that ends takes the server's copies of past versions with it.
      return { ...state, review: action.review, baselines: action.review ? state.baselines : {} };
    case "chat-remove":
      if (action.thread !== state.thread) return state;
      return { ...state, chat: state.chat.filter((item) => item.id !== action.id) };
    case "baseline":
      return { ...state, baselines: { ...state.baselines, [action.baseline.id]: action.baseline } };
    case "snapshot":
      return { ...state, snapshots: { ...state.snapshots, [action.snapshot.id]: action.snapshot } };
  }
}

/**
 * Keeps a WebSocket to the Basis server open and mirrors the state of the project this tab shows, with the chat of
 * the thread it shows. What the chrome sends names the project it was sent from (App tags it) and the thread
 * (Workbench tags it), so a message sent while the next one opens still reaches the project it was meant for.
 */
export function useBridge(): { state: BridgeState; send: (message: Tagged<ClientMessage>) => void } {
  const [state, dispatch] = useReducer(reduce, initial);
  const socket = useRef<WebSocket | null>(null);
  /** The project of the last hello and the thread shown: what this tab shows, and asks for again when it reconnects. */
  const shown = useRef<{ project: string; thread: string } | undefined>(undefined);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const query = shown.current
        ? `?project=${encodeURIComponent(shown.current.project)}&thread=${encodeURIComponent(shown.current.thread)}`
        : "";
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/bridge${query}`);
      socket.current = ws;
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as Tagged<ServerMessage>;
        if (message.type === "hello") shown.current = { project: message.project.id, thread: message.thread };
        if (message.type === "thread" && shown.current && shown.current.project === message.projectId)
          shown.current = { project: shown.current.project, thread: message.thread };
        dispatch(message);
      };
      ws.onclose = () => {
        dispatch({ type: "connected", connected: false });
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      const ws = socket.current;
      if (!ws) return;
      ws.onmessage = null;
      ws.onclose = null;
      // Closing a socket that is still connecting logs a browser warning, so let it open first.
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    };
  }, []);

  const send = useCallback((message: Tagged<ClientMessage>) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  return { state, send };
}
