import { useEffect, useState } from "react";
import { COLOR_ROLES, type ColorRole, type Design } from "../../shared/design.ts";
import { kebab } from "../../shared/tokens.ts";

export type Rgba = readonly [r: number, g: number, b: number, a: number];
export type ResolvedTheme = Partial<Record<ColorRole, Rgba>>;

let canvasContext: CanvasRenderingContext2D | null = null;

/** Turns any CSS colour the browser understands (oklch, color-mix …) into sRGB bytes. */
function toRgba(cssColor: string): Rgba | undefined {
  canvasContext ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const ctx = canvasContext;
  if (!ctx) return undefined;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "rgb(0 0 0 / 0)";
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

/**
 * Resolves every colour role for both themes by letting the browser compute
 * the scoped custom properties, so var() references and color-mix() work.
 */
export function useResolvedColors(design: Design): Record<"light" | "dark", ResolvedTheme> {
  const [resolved, setResolved] = useState<Record<"light" | "dark", ResolvedTheme>>({ light: {}, dark: {} });

  useEffect(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
    document.body.append(host);
    const result: Record<"light" | "dark", ResolvedTheme> = { light: {}, dark: {} };
    for (const theme of ["light", "dark"] as const) {
      const scope = document.createElement("div");
      scope.className = "ds-root";
      scope.dataset.theme = theme;
      const probe = document.createElement("span");
      scope.append(probe);
      host.append(scope);
      for (const role of COLOR_ROLES) {
        probe.style.color = `var(--color-${kebab(role)})`;
        const rgba = toRgba(getComputedStyle(probe).color);
        if (rgba) result[theme][role] = rgba;
      }
    }
    host.remove();
    setResolved(result);
  }, [design]);

  return resolved;
}

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
