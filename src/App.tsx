import { useBridge } from "./bridge.ts";
import styles from "./shell/Shell.module.css";
import { Workbench } from "./Workbench.tsx";

/**
 * Keeps the connection to the server and mounts the workbench for the open
 * project. The workbench is keyed by project, so switching projects starts it
 * fresh instead of carrying picks, sections or an inspected version across.
 */
export function App() {
  const { state, send } = useBridge();
  return (
    <>
      <Workbench key={state.project?.id ?? "connecting"} state={state} send={send} />
      {state.switching && (
        <div className={styles.switching} role="status">
          <span className={styles.switchingCard}>Opening {state.switching.name}…</span>
        </div>
      )}
    </>
  );
}
