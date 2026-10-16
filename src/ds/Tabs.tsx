import { useRef, type KeyboardEvent } from "react";
import styles from "./Tabs.module.css";
import type { ForcedState } from "./util.ts";

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  force?: Exclude<ForcedState, "active">;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  variant: string;
  label: string;
}

export function Tabs({ items, value, onChange, variant, label }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === value);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange?.(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={list} className={styles.list} role="tablist" aria-label={label} data-variant={variant} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={styles.tab}
            data-tab={item.id}
            data-force={item.force}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange?.(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
