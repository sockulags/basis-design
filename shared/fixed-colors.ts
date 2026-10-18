import type { Design } from "./design.ts";

/**
 * Finds colours written as fixed values outside the colour roles: hex, colour
 * functions with literal channels, and white/black. Such a value is the same in
 * both themes, so a sheen or shadow tuned on the light page goes missing or
 * glares on the dark one. Values derived from a role (var(), color-mix() with a
 * var(), relative colours like oklch(from var(--x) ...)) follow the theme and
 * pass, and so do transparent and currentColor.
 */

const FUNCTIONS = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const HEX = /(?<![\w&-])#[0-9a-f]{3,8}(?![\w-])/gi;
const KEYWORDS = /(?<![\w-])(white|black)(?![\w-])/gi;
/**
 * A mask only uses a colour's alpha, so black and white there are not colours anyone sees; font names may
 * contain the words ("Archivo Black").
 */
const SKIPPED_PROPERTY = /^(-webkit-)?mask|^font/i;
const MAX_FINDINGS = 30;

/** The text from `open` (just after an opening parenthesis) to its matching close, without the close. */
function inside(text: string, open: number): string {
  let depth = 1;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")" && --depth === 0) return text.slice(open, index);
  }
  return text.slice(open);
}

/** The fixed colours in one CSS value, in order of appearance and without repeats. */
export function fixedColorsInValue(value: string): string[] {
  // Strings and url()s can hold # and colour words that are not colours (content: "#1", url(#icon)).
  const text = value.replace(/"[^"]*"|'[^']*'/g, '""').replace(/url\([^)]*\)/gi, "url()");
  const found: { at: number; color: string }[] = [];
  for (const match of text.matchAll(FUNCTIONS)) {
    const args = inside(text, match.index + match[0].length);
    if (/^\s*from\s/i.test(args) || /var\(/i.test(args)) continue;
    found.push({ at: match.index, color: `${match[0]}${args})`.replace(/\s+/g, " ") });
  }
  for (const pattern of [HEX, KEYWORDS]) {
    for (const match of text.matchAll(pattern)) found.push({ at: match.index, color: match[0].toLowerCase() });
  }
  // A literal nested in another (rgb(from white ...)) is reported once, as the outer function when it is fixed.
  const colors = found
    .sort((a, b) => a.at - b.at)
    .filter((item, _, all) => !all.some((other) => other.at < item.at && other.at + other.color.length > item.at))
    .map((item) => item.color);
  return [...new Set(colors)];
}

/** The fixed colours in a stylesheet's declarations (selectors and comments are skipped). */
export function fixedColorsInCss(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const colors: string[] = [];
  for (const match of text.matchAll(/([-\w]+)\s*:([^;{}]*)(?=[;}])/g)) {
    const [, property = "", value = ""] = match;
    if (SKIPPED_PROPERTY.test(property)) continue;
    colors.push(...fixedColorsInValue(value));
  }
  return [...new Set(colors)];
}

function walk(value: unknown, at: string, out: [path: string, value: string][]): void {
  if (typeof value === "string") out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}.${index}`, out));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) walk(item, at ? `${at}.${key}` : key, out);
}

/**
 * Findings for the agent and the user, one per fixed colour and place, so the
 * text stays the same while the colour does (the fix loop compares it). The
 * colour roles under `color` are where fixed colours belong, and typography
 * holds none (only font names that may contain the words), so both are skipped.
 */
export function fixedColorFindings(design: Design, stylesheets: { file: string; css: string }[]): string[] {
  const tokens: [string, string][] = [];
  const { color: _roles, typography: _typography, ...rest } = design;
  walk(rest, "", tokens);
  const findings = [
    ...tokens.flatMap(([at, value]) =>
      fixedColorsInValue(value).map((color) => `design-system.json ${at} uses the fixed colour ${color}`),
    ),
    ...stylesheets.flatMap(({ file, css }) =>
      fixedColorsInCss(css).map((color) => `${file} uses the fixed colour ${color}`),
    ),
  ];
  return findings.slice(0, MAX_FINDINGS);
}
