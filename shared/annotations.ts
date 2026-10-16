/**
 * An element the user picked in the preview and attached to a prompt, so the
 * agent knows exactly which component, state and tokens they mean.
 */
export interface Annotation {
  /** e.g. "button", "input", "swatch". */
  component: string;
  section?: string;
  variant?: string;
  state?: string;
  theme: "light" | "dark";
  /** JSON path of the token group or token the element is driven by, e.g. "components.button". */
  tokenPath?: string;
  /** Current values under tokenPath. */
  tokens: Record<string, string>;
  /** A few computed styles as rendered. */
  styles: Record<string, string>;
}

export function annotationLabel(annotation: Annotation): string {
  return [annotation.component, annotation.variant, annotation.state].filter(Boolean).join(" · ");
}

/** Plain-text form sent to the agent ahead of the user's message. */
export function formatAnnotations(annotations: Annotation[]): string {
  const blocks = annotations.map((annotation, index) => {
    const lines = [
      `[${index + 1}] ${annotationLabel(annotation)} — section "${annotation.section ?? "?"}", ${annotation.theme} theme`,
    ];
    if (annotation.tokenPath) {
      const tokens = Object.entries(annotation.tokens)
        .map(([key, value]) => `${key}: ${value}`)
        .join("; ");
      lines.push(`    tokens at ${annotation.tokenPath}: ${tokens || "(none)"}`);
    }
    const styles = Object.entries(annotation.styles)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
    if (styles) lines.push(`    rendered: ${styles}`);
    return lines.join("\n");
  });
  return `The user pointed at these elements in the Basis preview. Numbers like [1] in their message refer to them.\n${blocks.join("\n")}`;
}
