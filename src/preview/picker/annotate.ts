import type { Annotation } from "../../../shared/annotations.ts";
import type { Design } from "../../../shared/design.ts";

/** Which component token group drives each picked element. */
const COMPONENT_GROUP: Record<string, keyof Design["components"]> = {
  button: "button",
  input: "input",
  textarea: "input",
  select: "input",
  checkbox: "control",
  radio: "control",
  switch: "control",
  card: "card",
  badge: "badge",
  tabs: "tabs",
  tab: "tabs",
  alert: "alert",
  tooltip: "tooltip",
  toast: "toast",
  dialog: "dialog",
  progress: "progress",
};

const STYLE_PROPS = [
  "background-color",
  "color",
  "border",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-transform",
  "padding",
  "height",
  "transform",
] as const;

const BORING = new Set(["none", "normal", "0px", "rgba(0, 0, 0, 0)", "auto"]);

export function pickable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-ds]");
  // The "before" side of a review is history: annotating it would describe code the agent no longer has.
  return el?.closest(".ds-root") && !el.closest('[data-side="baseline"]') ? el : null;
}

function tokensFor(el: HTMLElement, design: Design): Pick<Annotation, "tokenPath" | "tokens"> {
  const token = el.dataset.token;
  if (token?.startsWith("color.*.")) {
    const role = token.slice("color.*.".length) as keyof Design["color"]["light"];
    return {
      tokenPath: `color.{light,dark}.${role}`,
      tokens: { light: design.color.light[role], dark: design.color.dark[role] },
    };
  }
  if (token) {
    const value = token
      .split(".")
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], design);
    return { tokenPath: token, tokens: { value: typeof value === "string" ? value : JSON.stringify(value) } };
  }
  const group = COMPONENT_GROUP[el.dataset.ds ?? ""];
  if (!group) return { tokens: {} };
  return { tokenPath: `components.${group}`, tokens: { ...design.components[group] } as Record<string, string> };
}

export function annotate(el: HTMLElement, design: Design): Annotation {
  const cell = el.closest<HTMLElement>("[data-row], [data-state-label]");
  const section = el.closest("section")?.querySelector("h2")?.textContent ?? undefined;
  const theme = el.closest<HTMLElement>(".ds-root[data-theme]")?.dataset.theme === "dark" ? "dark" : "light";
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop).trim();
    if (value && !BORING.has(value)) styles[prop] = prop === "font-family" ? (value.split(",")[0] ?? value) : value;
  }
  const force = el.dataset.force === "active" ? "pressed" : el.dataset.force;
  const disabled = el.matches(":disabled") || el.querySelector(":disabled") ? "disabled" : undefined;
  return {
    component: el.dataset.ds ?? "element",
    section,
    variant: el.dataset.variant ?? cell?.dataset.row,
    state: cell?.dataset.col ?? cell?.dataset.stateLabel ?? force ?? disabled,
    theme,
    ...tokensFor(el, design),
    styles,
  };
}
