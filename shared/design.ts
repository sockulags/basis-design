import { z } from "zod";

/**
 * The design system document the agent edits (`design-system.json`).
 * Every leaf is a CSS value string except a few enums. Missing keys fall back
 * to DEFAULT_DESIGN; unknown keys are rejected so typos surface immediately.
 */

// Values are injected into stylesheets, so characters that could end a declaration or block are refused.
const cssValue = z
  .string()
  .trim()
  .min(1, "must be a non-empty CSS value")
  .refine((value) => !/[{};<>]/.test(value), { message: "a CSS value cannot contain { } ; < or >" });

function group<const K extends string>(keys: readonly K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, cssValue])) as Record<K, typeof cssValue>;
  return z.object(shape).strict();
}

export const COLOR_ROLES = [
  "bg",
  "surface",
  "surfaceRaised",
  "surfaceSunken",
  "border",
  "borderStrong",
  "text",
  "textMuted",
  "textSubtle",
  "primary",
  "primaryHover",
  "primaryActive",
  "primarySubtle",
  "onPrimary",
  "secondary",
  "secondaryHover",
  "secondaryActive",
  "onSecondary",
  "accent",
  "onAccent",
  "info",
  "infoSubtle",
  "infoStrong",
  "onInfo",
  "success",
  "successSubtle",
  "successStrong",
  "onSuccess",
  "warning",
  "warningSubtle",
  "warningStrong",
  "onWarning",
  "danger",
  "dangerHover",
  "dangerActive",
  "dangerSubtle",
  "dangerStrong",
  "onDanger",
  "focusRing",
  "overlay",
  "disabledBg",
  "disabledText",
  "selection",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

const colorSet = group(COLOR_ROLES);

const FONT_HOSTS = ["https://fonts.googleapis.com/", "https://fonts.bunny.net/"];

export const TABS_VARIANTS = ["underline", "pill", "segmented"] as const;

const componentsSchema = z
  .object({
    button: group([
      "radius",
      "heightSm",
      "heightMd",
      "heightLg",
      "paddingX",
      "gap",
      "fontSize",
      "fontWeight",
      "letterSpacing",
      "textTransform",
      "borderWidth",
      "shadow",
      "shadowHover",
      "pressScale",
      "transition",
    ]),
    input: group([
      "radius",
      "height",
      "paddingX",
      "fontSize",
      "bg",
      "borderWidth",
      "borderColor",
      "borderColorHover",
      "shadow",
      "transition",
    ]),
    control: group(["size", "radius", "switchWidth", "switchHeight", "thumbInset", "transition"]),
    card: group(["radius", "padding", "bg", "borderWidth", "shadow", "shadowHover", "liftHover", "transition"]),
    badge: group(["radius", "height", "paddingX", "fontSize", "fontWeight", "letterSpacing", "textTransform"]),
    tabs: z
      .object({
        variant: z.enum(TABS_VARIANTS),
        radius: cssValue,
        gap: cssValue,
        fontWeight: cssValue,
        indicatorHeight: cssValue,
        transition: cssValue,
      })
      .strict(),
    alert: group(["radius", "padding", "borderWidth", "accentWidth"]),
    tooltip: group(["radius", "bg", "fg", "fontSize", "paddingX", "paddingY", "shadow"]),
    toast: group(["radius", "padding", "shadow", "width"]),
    dialog: group(["radius", "padding", "shadow", "width", "overlayBlur"]),
    progress: group(["height", "radius"]),
  })
  .strict();

export const designSchema = z
  .object({
    $schemaVersion: z.literal(1),
    name: z.string().trim().min(1),
    description: z.string(),
    color: z.object({ light: colorSet, dark: colorSet }).strict(),
    typography: z
      .object({
        fontImports: z.array(
          z.string().refine((url) => FONT_HOSTS.some((host) => url.startsWith(host)) && !/["'()<>\s]/.test(url), {
            message: `font stylesheet must start with ${FONT_HOSTS.join(" or ")}`,
          }),
        ),
        family: group(["sans", "display", "mono"]),
        size: group(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]),
        weight: group(["regular", "medium", "semibold", "bold"]),
        leading: group(["tight", "snug", "normal", "relaxed"]),
        tracking: group(["tight", "normal", "wide", "caps"]),
      })
      .strict(),
    space: group(["1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"]),
    radius: group(["none", "xs", "sm", "md", "lg", "xl", "full"]),
    border: group(["thin", "thick"]),
    shadow: group(["xs", "sm", "md", "lg", "xl"]),
    motion: z
      .object({
        duration: group(["instant", "fast", "base", "slow", "slower"]),
        ease: group(["standard", "enter", "exit", "emphasized", "spring"]),
      })
      .strict(),
    focus: group(["ringWidth", "ringOffset"]),
    opacity: group(["disabled", "muted"]),
    components: componentsSchema,
  })
  .strict();

export type Design = z.infer<typeof designSchema>;

export const DEFAULT_DESIGN: Design = {
  $schemaVersion: 1,
  name: "Basis",
  description: "A calm, warm-neutral starting point with a deep teal brand color.",
  color: {
    light: {
      bg: "#f8f7f4",
      surface: "#ffffff",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#f0eee9",
      border: "#e2dfd8",
      borderStrong: "#c9c4ba",
      text: "#1c1b19",
      textMuted: "#57534c",
      textSubtle: "#7d786f",
      primary: "#0f6e66",
      primaryHover: "#0c5d56",
      primaryActive: "#094b45",
      primarySubtle: "#e1f1ee",
      onPrimary: "#ffffff",
      secondary: "#eceae5",
      secondaryHover: "#e2dfd8",
      secondaryActive: "#d6d2c9",
      onSecondary: "#1c1b19",
      accent: "#c2552d",
      onAccent: "#ffffff",
      info: "#2563a8",
      infoSubtle: "#e4eef9",
      infoStrong: "#1b4a7f",
      onInfo: "#ffffff",
      success: "#2f7d4a",
      successSubtle: "#e3f3e8",
      successStrong: "#1f5a34",
      onSuccess: "#ffffff",
      warning: "#c98a1e",
      warningSubtle: "#fbf0dc",
      warningStrong: "#7c5110",
      onWarning: "#1c1b19",
      danger: "#c03a2b",
      dangerHover: "#a63124",
      dangerActive: "#8b281d",
      dangerSubtle: "#fbe7e4",
      dangerStrong: "#8b281d",
      onDanger: "#ffffff",
      focusRing: "#0f6e66",
      overlay: "rgb(28 27 25 / 0.45)",
      disabledBg: "#eceae5",
      disabledText: "#a39e94",
      selection: "#cfe7e3",
    },
    dark: {
      bg: "#141413",
      surface: "#1c1b19",
      surfaceRaised: "#252421",
      surfaceSunken: "#0f0f0e",
      border: "#33312d",
      borderStrong: "#4a4741",
      text: "#f2f0ec",
      textMuted: "#b4afa6",
      textSubtle: "#8d887f",
      primary: "#3fb8a9",
      primaryHover: "#5ccabb",
      primaryActive: "#2fa092",
      primarySubtle: "#10302c",
      onPrimary: "#08201d",
      secondary: "#2a2926",
      secondaryHover: "#33312d",
      secondaryActive: "#3d3b36",
      onSecondary: "#f2f0ec",
      accent: "#e57a52",
      onAccent: "#1c1b19",
      info: "#6aa6e8",
      infoSubtle: "#14263a",
      infoStrong: "#a9cbf2",
      onInfo: "#0b1a2b",
      success: "#5cbf7e",
      successSubtle: "#13291b",
      successStrong: "#a3dcb5",
      onSuccess: "#0b2013",
      warning: "#e0a84a",
      warningSubtle: "#2e2210",
      warningStrong: "#f0cd8e",
      onWarning: "#1c1b19",
      danger: "#ef6b5b",
      dangerHover: "#f38778",
      dangerActive: "#d9564a",
      dangerSubtle: "#34160f",
      dangerStrong: "#f6aca1",
      onDanger: "#1c0906",
      focusRing: "#5ccabb",
      overlay: "rgb(0 0 0 / 0.6)",
      disabledBg: "#23221f",
      disabledText: "#6b675f",
      selection: "#1d4a44",
    },
  },
  typography: {
    fontImports: [],
    family: {
      sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
    },
    size: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
    },
    weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    leading: { tight: "1.15", snug: "1.3", normal: "1.5", relaxed: "1.7" },
    tracking: { tight: "-0.02em", normal: "0em", wide: "0.02em", caps: "0.08em" },
  },
  space: {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px",
    "20": "80px",
  },
  radius: { none: "0", xs: "2px", sm: "4px", md: "8px", lg: "12px", xl: "16px", full: "9999px" },
  border: { thin: "1px", thick: "2px" },
  shadow: {
    xs: "0 1px 2px rgb(20 18 15 / 0.06)",
    sm: "0 1px 3px rgb(20 18 15 / 0.08), 0 1px 2px rgb(20 18 15 / 0.05)",
    md: "0 4px 12px rgb(20 18 15 / 0.08), 0 2px 4px rgb(20 18 15 / 0.05)",
    lg: "0 12px 28px rgb(20 18 15 / 0.12), 0 4px 8px rgb(20 18 15 / 0.06)",
    xl: "0 24px 56px rgb(20 18 15 / 0.18), 0 8px 16px rgb(20 18 15 / 0.08)",
  },
  motion: {
    duration: { instant: "50ms", fast: "120ms", base: "200ms", slow: "320ms", slower: "500ms" },
    ease: {
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      enter: "cubic-bezier(0, 0, 0.2, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      emphasized: "cubic-bezier(0.3, 0, 0, 1)",
      spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    },
  },
  focus: { ringWidth: "2px", ringOffset: "2px" },
  opacity: { disabled: "0.55", muted: "0.7" },
  components: {
    button: {
      radius: "var(--radius-md)",
      heightSm: "32px",
      heightMd: "40px",
      heightLg: "48px",
      paddingX: "var(--space-4)",
      gap: "var(--space-2)",
      fontSize: "var(--text-sm)",
      fontWeight: "var(--weight-semibold)",
      letterSpacing: "var(--tracking-normal)",
      textTransform: "none",
      borderWidth: "var(--border-thin)",
      shadow: "var(--shadow-xs)",
      shadowHover: "var(--shadow-sm)",
      pressScale: "0.98",
      transition:
        "background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), transform var(--duration-instant) var(--ease-standard)",
    },
    input: {
      radius: "var(--radius-md)",
      height: "40px",
      paddingX: "var(--space-3)",
      fontSize: "var(--text-sm)",
      bg: "var(--color-surface)",
      borderWidth: "var(--border-thin)",
      borderColor: "var(--color-border-strong)",
      borderColorHover: "var(--color-text-subtle)",
      shadow: "none",
      transition:
        "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
    },
    control: {
      size: "18px",
      radius: "var(--radius-xs)",
      switchWidth: "36px",
      switchHeight: "20px",
      thumbInset: "2px",
      transition:
        "background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-base) var(--ease-spring)",
    },
    card: {
      radius: "var(--radius-lg)",
      padding: "var(--space-5)",
      bg: "var(--color-surface)",
      borderWidth: "var(--border-thin)",
      shadow: "var(--shadow-xs)",
      shadowHover: "var(--shadow-md)",
      liftHover: "-2px",
      transition:
        "box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
    },
    badge: {
      radius: "var(--radius-full)",
      height: "22px",
      paddingX: "var(--space-2)",
      fontSize: "var(--text-xs)",
      fontWeight: "var(--weight-medium)",
      letterSpacing: "var(--tracking-normal)",
      textTransform: "none",
    },
    tabs: {
      variant: "underline",
      radius: "var(--radius-md)",
      gap: "var(--space-1)",
      fontWeight: "var(--weight-medium)",
      indicatorHeight: "2px",
      transition: "color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)",
    },
    alert: {
      radius: "var(--radius-md)",
      padding: "var(--space-4)",
      borderWidth: "var(--border-thin)",
      accentWidth: "0px",
    },
    tooltip: {
      radius: "var(--radius-sm)",
      bg: "var(--color-text)",
      fg: "var(--color-bg)",
      fontSize: "var(--text-xs)",
      paddingX: "var(--space-2)",
      paddingY: "var(--space-1)",
      shadow: "var(--shadow-md)",
    },
    toast: {
      radius: "var(--radius-lg)",
      padding: "var(--space-4)",
      shadow: "var(--shadow-lg)",
      width: "360px",
    },
    dialog: {
      radius: "var(--radius-xl)",
      padding: "var(--space-6)",
      shadow: "var(--shadow-xl)",
      width: "440px",
      overlayBlur: "2px",
    },
    progress: { height: "8px", radius: "var(--radius-full)" },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively fills holes in `value` from `base`. Arrays and scalars in `value` win. */
export function mergeDefaults(base: unknown, value: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(value)) return value === undefined ? base : value;
  const out: Record<string, unknown> = { ...base };
  for (const [key, child] of Object.entries(value)) out[key] = mergeDefaults(base[key], child);
  return out;
}

export type DesignValidation = { ok: true; design: Design } | { ok: false; errors: string[] };

export function validateDesign(raw: unknown): DesignValidation {
  const parsed = designSchema.safeParse(mergeDefaults(DEFAULT_DESIGN, raw));
  if (parsed.success) return { ok: true, design: parsed.data };
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, errors };
}

export function parseDesignText(text: string): DesignValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`design-system.json is not valid JSON: ${(error as Error).message}`] };
  }
  return validateDesign(raw);
}
