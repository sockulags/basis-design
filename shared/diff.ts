export interface TokenChange {
  path: string;
  before: string | undefined;
  after: string | undefined;
}

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  out.set(prefix, typeof value === "string" ? value : JSON.stringify(value));
}

/** Leaf-level differences between two design documents, in document order. */
export function diffDesigns(before: unknown, after: unknown): TokenChange[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, "", a);
  flatten(after, "", b);
  const changes: TokenChange[] = [];
  for (const path of new Set([...b.keys(), ...a.keys()])) {
    if (a.get(path) !== b.get(path)) changes.push({ path, before: a.get(path), after: b.get(path) });
  }
  return changes;
}
