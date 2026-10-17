import { useEffect, useState } from "react";
import type { ResolvedColors, Rgba } from "../../shared/contrast.ts";
import { COLOR_ROLES, type ColorRole, type Design } from "../../shared/design.ts";
import { kebab } from "../../shared/tokens.ts";

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
export function useResolvedColors(design: Design): ResolvedColors {
  const [resolved, setResolved] = useState<ResolvedColors>({ light: {}, dark: {} });

  useEffect(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
    document.body.append(host);
    const result: ResolvedColors = { light: {}, dark: {} };
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
