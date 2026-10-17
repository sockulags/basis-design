import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  AgentState,
  Baseline,
  ChatItem,
  ClientMessage,
  DesignState,
  HistoryEntry,
  ExportWriteResult,
  ServerMessage,
  Snapshot,
} from "../shared/protocol.ts";
import type { ReviewState } from "../shared/review.ts";

export interface BridgeState {
  connected: boolean;
  design: DesignState | null;
  history: HistoryEntry[];
  agent: AgentState | null;
  chat: ChatItem[];
  /** History snapshots fetched for inspection, by entry id. */
  snapshots: Record<string, Snapshot>;
  /** The open review, if any. */
  review: ReviewState | null;
  /** Past versions materialised for reviews, by commit id. */
  baselines: Record<string, Baseline>;
  /** Port of the sandboxed preview origin, from the server. */
  previewPort: number | null;
  exportManifest: { folder: string; files: { path: string; bytes: number }[] } | null;
  exportResult: ExportWriteResult | null;
}

const initial: BridgeState = {
  connected: false,
  design: null,
  history: [],
  agent: null,
  chat: [],
  snapshots: {},
  review: null,
  baselines: {},
  previewPort: null,
  exportManifest: null,
  exportResult: null,
};

type Action = ServerMessage | { type: "connected"; connected: boolean };

function reduce(state: BridgeState, action: Action): BridgeState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected };
    case "hello":
      return {
        ...state,
        connected: true,
        previewPort: action.previewPort,
        design: action.design,
        history: action.history,
        agent: action.agent,
        chat: action.chat,
        review: action.review,
      };
    case "design":
      return { ...state, design: action.design };
    case "history":
      return { ...state, history: action.history };
    case "agent":
      return { ...state, agent: action.agent };
    case "chat-reset":
      return { ...state, chat: [] };
    case "chat-upsert": {
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
    case "review":
      return { ...state, review: action.review };
    case "chat-remove":
      return { ...state, chat: state.chat.filter((item) => item.id !== action.id) };
    case "baseline":
      return { ...state, baselines: { ...state.baselines, [action.baseline.id]: action.baseline } };
    case "snapshot":
      return { ...state, snapshots: { ...state.snapshots, [action.snapshot.id]: action.snapshot } };
  }
}

/** Keeps a WebSocket to the Basis server open and mirrors its state. */
export function useBridge(): { state: BridgeState; send: (message: ClientMessage) => void } {
  const [state, dispatch] = useReducer(reduce, initial);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/bridge`);
      socket.current = ws;
      ws.onmessage = (event) => dispatch(JSON.parse(String(event.data)) as ServerMessage);
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

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  return { state, send };
}
