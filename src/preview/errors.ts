/**
 * Render problems the preview currently shows, keyed by where they came from
 * (a gallery section, the Vite compiler, an uncaught error). The preview
 * reports the list to the chrome, which forwards it to the agent's fix loop.
 */
const problems = new Map<string, string>();
const listeners = new Set<(errors: string[]) => void>();

/** The problems shown now, as they are reported; a fresh document reports them at once, even when there are none. */
export function currentProblems(): string[] {
  return [...problems.entries()].map(([key, message]) => `${key}: ${message}`);
}

function notify(): void {
  const list = currentProblems();
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
/** Checks that are scheduled or running; the fix loop waits for them before it looks at the findings. */
const checking = new Set<string>();
const findingListeners = new Set<(checks: string[], running: boolean) => void>();

/** Every finding now, led by its check's name, and whether a check is still to come. */
export function currentFindings(): { checks: string[]; running: boolean } {
  const checks = [...findings.entries()].flatMap(([key, items]) => items.map((item) => `${key}: ${item}`));
  return { checks, running: checking.size > 0 };
}

function notifyFindings(): void {
  const { checks, running } = currentFindings();
  for (const listener of findingListeners) listener(checks, running);
}

export function setFindings(check: string, list: string[]): void {
  const current = findings.get(check) ?? [];
  if (current.length === list.length && current.every((item, index) => item === list[index])) return;
  if (list.length) findings.set(check, list);
  else findings.delete(check);
  notifyFindings();
}

export function setChecking(check: string, running: boolean): void {
  if (running === checking.has(check)) return;
  if (running) checking.add(check);
  else checking.delete(check);
  notifyFindings();
}

export function onFindings(listener: (checks: string[], running: boolean) => void): () => void {
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
