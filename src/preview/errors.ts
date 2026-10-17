/**
 * Render problems the preview currently shows, keyed by where they came from
 * (a gallery section, the Vite compiler, an uncaught error). The preview
 * reports the list to the chrome, which forwards it to the agent's fix loop.
 */
const problems = new Map<string, string>();
const listeners = new Set<(errors: string[]) => void>();

function notify(): void {
  const list = [...problems.entries()].map(([key, message]) => `${key}: ${message}`);
  for (const listener of listeners) listener(list);
}

export function setProblem(key: string, message: string | null): void {
  if (message === null ? !problems.delete(key) : problems.get(key) === message) return;
  if (message !== null) problems.set(key, message);
  notify();
}

export function clearProblems(prefix: string): void {
  let changed = false;
  for (const key of problems.keys()) {
    if (key.startsWith(prefix)) changed = problems.delete(key) || changed;
  }
  if (changed) notify();
}

export function onProblems(listener: (errors: string[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Findings of the automatic checks (contrast, accessibility), keyed by check.
 * They are not render failures: the chrome lists them, and the fix loop only
 * sends the agent the ones its last change introduced.
 */
const findings = new Map<string, string[]>();
const findingListeners = new Set<(checks: string[]) => void>();

export function setFindings(check: string, list: string[]): void {
  const current = findings.get(check) ?? [];
  if (current.length === list.length && current.every((item, index) => item === list[index])) return;
  if (list.length) findings.set(check, list);
  else findings.delete(check);
  const all = [...findings.entries()].flatMap(([key, items]) => items.map((item) => `${key}: ${item}`));
  for (const listener of findingListeners) listener(all);
}

export function onFindings(listener: (checks: string[]) => void): () => void {
  findingListeners.add(listener);
  return () => findingListeners.delete(listener);
}

const updateListeners = new Set<() => void>();

/** Called by the preview entry after every hot update, so failed sections can try again with the new code. */
export function hotUpdated(): void {
  for (const listener of updateListeners) listener();
}

export function onHotUpdate(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}
