import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/*
 * Per-viewer UI preferences in localStorage. Storage can be unavailable
 * (private mode, blocked site data); the app then just uses its defaults.
 */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`basis:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`basis:${key}`, value);
  } catch {
    // The preference only lasts for this visit.
  }
}

type Theme = "light" | "dark";

/**
 * The preview theme: the system's, followed live, until the user picks one.
 * The pick lasts for this tab (session storage), so a new visit starts from
 * the system again.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [system, setSystem] = useState<Theme>(systemTheme);
  const [chosen, setChosen] = useState<Theme | null>(() => {
    try {
      const stored = sessionStorage.getItem("basis:theme");
      return stored === "light" || stored === "dark" ? stored : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(systemTheme());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const choose = (theme: Theme) => {
    setChosen(theme);
    try {
      sessionStorage.setItem("basis:theme", theme);
    } catch {
      // The pick only lasts until the page reloads.
    }
  };
  return [chosen ?? system, choose];
}

function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * State that starts from a stored preference and is stored again when it
 * changes. `decode` turns the stored text (or null) into a valid value;
 * `delay` debounces writes for values that change on every keystroke.
 */
export function usePref<T>(
  key: string,
  decode: (stored: string | null) => T,
  { encode = String, delay = 0 }: { encode?: (value: T) => string; delay?: number } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => decode(readPref(key)));
  useEffect(() => {
    if (!delay) return writePref(key, encode(value));
    const timer = setTimeout(() => writePref(key, encode(value)), delay);
    return () => clearTimeout(timer);
    // encode is a formatting function, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, delay]);
  return [value, setValue];
}
