import type { ColorRole } from "./design.ts";

/**
 * WCAG 2 contrast between the colour roles, as the gallery shows it and the
 * fix loop checks it. Colours arrive resolved to sRGB (the preview lets the
 * browser compute them, so any CSS colour works).
 */

export type Rgba = readonly [r: number, g: number, b: number, a: number];
export type ResolvedColors = Record<"light" | "dark", Partial<Record<ColorRole, Rgba>>>;

/**
 * Pairs checked for contrast, with the WCAG target that applies to how the pair is used: 4.5:1 for text, 3:1
 * for large or secondary text and for indicators. Disabled text is exempt in WCAG, and borders are left out:
 * most systems draw them below 3:1 on purpose.
 */
export const CONTRAST_PAIRS: { fg: ColorRole; bg: ColorRole; target: number }[] = [
  { fg: "text", bg: "bg", target: 4.5 },
  { fg: "text", bg: "surface", target: 4.5 },
  { fg: "text", bg: "surfaceRaised", target: 4.5 },
  { fg: "text", bg: "surfaceSunken", target: 4.5 },
  { fg: "textMuted", bg: "bg", target: 4.5 },
  { fg: "textMuted", bg: "surface", target: 4.5 },
  { fg: "textSubtle", bg: "surface", target: 3 },
  { fg: "primary", bg: "bg", target: 3 },
  { fg: "onPrimary", bg: "primary", target: 4.5 },
  { fg: "onPrimary", bg: "primaryHover", target: 4.5 },
  { fg: "onSecondary", bg: "secondary", target: 4.5 },
  { fg: "onAccent", bg: "accent", target: 4.5 },
  { fg: "onDanger", bg: "danger", target: 4.5 },
  { fg: "onDanger", bg: "dangerHover", target: 4.5 },
  { fg: "onSuccess", bg: "success", target: 4.5 },
  { fg: "onWarning", bg: "warning", target: 4.5 },
  { fg: "onInfo", bg: "info", target: 4.5 },
  { fg: "infoStrong", bg: "infoSubtle", target: 4.5 },
  { fg: "successStrong", bg: "successSubtle", target: 4.5 },
  { fg: "warningStrong", bg: "warningSubtle", target: 4.5 },
  { fg: "dangerStrong", bg: "dangerSubtle", target: 4.5 },
  { fg: "focusRing", bg: "bg", target: 3 },
];

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

/** WCAG 2 contrast ratio; translucent foregrounds are composited over the background first. */
export function contrast(foreground: Rgba, background: Rgba): number {
  const fg = foreground[3] < 1 ? over(foreground, background) : foreground;
  const a = luminance(fg);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every pair below its target, phrased for the agent: "dark textMuted on surface is 3.9:1, needs 4.5:1". */
export function contrastFailures(resolved: ResolvedColors): string[] {
  return (["light", "dark"] as const).flatMap((theme) =>
    CONTRAST_PAIRS.flatMap(({ fg, bg, target }) => {
      const a = resolved[theme][fg];
      const b = resolved[theme][bg];
      if (!a || !b) return [];
      const ratio = contrast(a, b);
      // Rounded down, so a pair shown as 4.5:1 never fails a 4.5:1 target.
      return ratio < target
        ? [`${theme} ${fg} on ${bg} is ${(Math.floor(ratio * 10) / 10).toFixed(1)}:1, needs ${target}:1`]
        : [];
    }),
  );
}
