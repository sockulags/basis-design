import { useEffect, useRef, useState } from "react";
import { isComponentName, pageById, type PageId } from "../../shared/frame.ts";
import type { ClientMessage } from "../../shared/protocol.ts";
import styles from "./Shell.module.css";

interface CreateDialogProps {
  page: PageId;
  /** False while the agent is busy or not connected; the dialog then explains why it cannot start. */
  agentReady: boolean;
  send: (message: ClientMessage) => void;
  /** Called after the request is sent, so the chat can come into view. */
  onCreated: () => void;
  onClose: () => void;
}

/** "date picker" and "date-picker" both become "DatePicker". */
function toComponentName(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
}

export function CreateDialog({ page, agentReady, send, onCreated, onClose }: CreateDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const { kind, folder } = pageById(page);
  const isView = kind === "view";
  const componentName = toComponentName(name);
  const nameProblem =
    name.trim() && !isComponentName(componentName) ? "Start with a letter; use letters and digits." : null;
  const canCreate = agentReady && isComponentName(componentName);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const create = () => {
    if (!canCreate) return;
    send({ type: "create", page, name: componentName, purpose: purpose.trim() });
    onCreated();
    dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.createDialog}`}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
    >
      <form
        className={styles.dialogInner}
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <header className={styles.dialogHeader}>
          <div>
            <h2>New {kind}</h2>
            <p>
              {isView ? (
                <>
                  The agent builds the feature's screens in <code>{folder}/</code> from your patterns and components,
                  with realistic data, as a flow you can click through, and opens it in a review.
                </>
              ) : (
                <>
                  The agent creates it in <code>{folder}/</code> with a specimen
                  {kind === "component" ? ", a contract and every state" : " built from the base components"}.
                </>
              )}
            </p>
          </div>
        </header>
        <div className={styles.createFields}>
          <label htmlFor="create-name">Name</label>
          <input
            id="create-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === "component" ? "DatePicker" : isView ? "ShipmentTracking" : "PricingTable"}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-describedby="create-name-hint"
            aria-invalid={nameProblem ? true : undefined}
          />
          <p id="create-name-hint" className={nameProblem ? styles.kitError : styles.muted}>
            {nameProblem ?? (componentName && componentName !== name.trim() ? `Created as ${componentName}` : " ")}
          </p>
          <label htmlFor="create-purpose">
            {isView ? "The feature, or the ticket text" : "What is it for?"}{" "}
            <span className={styles.muted}>Optional</span>
          </label>
          <textarea
            id="create-purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                create();
              }
            }}
            rows={isView ? 7 : 4}
            maxLength={isView ? 8000 : 2000}
            placeholder={
              kind === "component"
                ? "Pick a single date from a calendar popover; supports min/max and disabled days."
                : isView
                  ? "As a dispatcher I can see every shipment that is delayed, open one to see why, and notify the customer."
                  : "Three plan cards with a monthly/yearly toggle; the middle plan is highlighted."
            }
          />
        </div>
        <footer className={styles.dialogFooter}>
          <span className={styles.muted}>{agentReady ? "" : "The agent is busy. Try again when it is done."}</span>
          <button type="button" className={styles.chromeButton} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={!canCreate}>
            Create {kind}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
