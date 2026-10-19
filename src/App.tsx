import { useCallback } from "react";
import type { ClientMessage, Tagged } from "../shared/protocol.ts";
import { useBridge } from "./bridge.ts";
import styles from "./shell/Shell.module.css";
import { Workbench } from "./Workbench.tsx";

/**
 * Keeps the connection to the server and mounts the workbench for the project
 * this tab shows. The workbench is keyed by project, so switching projects
 * starts it fresh instead of carrying picks, sections or an inspected version
 * across. The other projects go on in the background on the server.
 */
export function App() {
  const { state, send } = useBridge();
  const projectId = state.project?.id;
  // Each workbench tags what it sends with its own project, so what the one on its way out sends (its gallery's
  // last report, say) still goes to the project it showed.
  const sendHere = useCallback((message: Tagged<ClientMessage>) => send({ ...message, projectId }), [send, projectId]);
  return (
    <>
      <Workbench key={projectId ?? "connecting"} state={state} send={sendHere} />
      {state.switching && (
        <div className={styles.switching} role="status">
          <span className={styles.switchingCard}>Opening {state.switching.name}…</span>
        </div>
      )}
    </>
  );
}
