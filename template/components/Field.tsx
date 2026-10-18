import { createContext, useContext, useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";
import type { ForcedState } from "./util.ts";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** What the control inside a Field takes from it: the id its label points at, what describes it, and its error. */
const FieldContext = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null);

/** Label, hint and error above the control, which screen readers hear as its name and description. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field} data-state-label={label}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
      <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
    </div>
  );
}

interface Forceable {
  force?: Exclude<ForcedState, "active">;
  invalid?: boolean;
}

/** A control's id, description and invalid state: its own props first, then what its Field gives it. */
function useFieldControl(invalid: boolean | undefined, id?: string, describedBy?: string) {
  const field = useContext(FieldContext);
  return {
    id: id ?? field?.id,
    "aria-describedby": [describedBy, field?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": (invalid ?? field?.invalid) || undefined,
  };
}

export function TextInput({ force, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & Forceable) {
  const control = useFieldControl(invalid, rest.id, rest["aria-describedby"]);
  return <input className={styles.input} data-ds="input" data-force={force} {...rest} {...control} />;
}

export function Textarea({ force, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & Forceable) {
  const control = useFieldControl(invalid, rest.id, rest["aria-describedby"]);
  return (
    <textarea
      className={`${styles.input} ${styles.textarea}`}
      data-ds="textarea"
      data-force={force}
      {...rest}
      {...control}
    />
  );
}

export function Select({ force, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Forceable) {
  const control = useFieldControl(invalid, rest.id, rest["aria-describedby"]);
  return (
    <span className={styles.selectWrap}>
      <select className={`${styles.input} ${styles.select}`} data-ds="select" data-force={force} {...rest} {...control}>
        {children}
      </select>
      <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden>
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
