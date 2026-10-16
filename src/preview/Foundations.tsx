import { useState } from "react";
import type { ColorRole, Design } from "../../shared/design.ts";
import { kebab } from "../../shared/tokens.ts";
import { Button } from "../ds/Button.tsx";
import { contrast, useResolvedColors, type ResolvedTheme } from "./color.ts";
import styles from "./Foundations.module.css";
import { Group, Section, Token } from "./Gallery.tsx";

interface FoundationProps {
  design: Design;
  onAsk: (prefix: string) => void;
}

const COLOR_GROUPS: { title: string; roles: ColorRole[] }[] = [
  { title: "Surfaces & lines", roles: ["bg", "surface", "surfaceRaised", "surfaceSunken", "border", "borderStrong"] },
  { title: "Text", roles: ["text", "textMuted", "textSubtle"] },
  {
    title: "Brand",
    roles: ["primary", "primaryHover", "primaryActive", "primarySubtle", "onPrimary", "accent", "onAccent"],
  },
  { title: "Secondary", roles: ["secondary", "secondaryHover", "secondaryActive", "onSecondary"] },
  {
    title: "Status",
    roles: [
      "info",
      "infoSubtle",
      "infoStrong",
      "success",
      "successSubtle",
      "successStrong",
      "warning",
      "warningSubtle",
      "warningStrong",
      "danger",
      "dangerSubtle",
      "dangerStrong",
    ],
  },
  { title: "Utility", roles: ["focusRing", "overlay", "disabledBg", "disabledText", "selection"] },
];

/** Pairs checked for contrast, with the WCAG target that applies to how the pair is used. */
const CONTRAST_PAIRS: { fg: ColorRole; bg: ColorRole; target: number }[] = [
  { fg: "text", bg: "bg", target: 4.5 },
  { fg: "text", bg: "surface", target: 4.5 },
  { fg: "textMuted", bg: "surface", target: 4.5 },
  { fg: "textSubtle", bg: "surface", target: 3 },
  { fg: "primary", bg: "bg", target: 3 },
  { fg: "onPrimary", bg: "primary", target: 4.5 },
  { fg: "onSecondary", bg: "secondary", target: 4.5 },
  { fg: "onAccent", bg: "accent", target: 4.5 },
  { fg: "onDanger", bg: "danger", target: 4.5 },
  { fg: "onSuccess", bg: "success", target: 4.5 },
  { fg: "onWarning", bg: "warning", target: 4.5 },
  { fg: "onInfo", bg: "info", target: 4.5 },
  { fg: "infoStrong", bg: "infoSubtle", target: 4.5 },
  { fg: "successStrong", bg: "successSubtle", target: 4.5 },
  { fg: "warningStrong", bg: "warningSubtle", target: 4.5 },
  { fg: "dangerStrong", bg: "dangerSubtle", target: 4.5 },
  { fg: "focusRing", bg: "bg", target: 3 },
];

function Ratio({ resolved, fg, bg, target }: { resolved: ResolvedTheme; fg: ColorRole; bg: ColorRole; target: number }) {
  const a = resolved[fg];
  const b = resolved[bg];
  if (!a || !b) return <span className={styles.ratio}>…</span>;
  const ratio = contrast(a, b);
  const pass = ratio >= target;
  return (
    <span className={styles.ratio} data-pass={pass}>
      <span className={styles.ratioSample} style={{ color: `rgb(${a.slice(0, 3).join(" ")})`, background: `rgb(${b.slice(0, 3).join(" ")})` }}>
        Aa
      </span>
      {ratio.toFixed(2)}
      <span className={styles.ratioBadge}>{pass ? "Pass" : "Fail"}</span>
    </span>
  );
}

export function Colors({ design, onAsk }: FoundationProps) {
  const resolved = useResolvedColors(design);
  const failures = (["light", "dark"] as const).flatMap((theme) =>
    CONTRAST_PAIRS.filter(({ fg, bg, target }) => {
      const a = resolved[theme][fg];
      const b = resolved[theme][bg];
      return a && b && contrast(a, b) < target;
    }).map((pair) => `${theme} ${pair.fg} on ${pair.bg}`),
  );

  return (
    <Section
      id="color"
      title="Color"
      description="Semantic roles for both themes. Components only ever read these roles, so changing a role restyles everything that uses it."
      onAsk={onAsk}
    >
      {COLOR_GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          <div className={styles.swatches}>
            {group.roles.map((role) => (
              <div key={role} className={styles.swatch} data-ds="color" data-token={`color.*.${role}`}>
                <div className={styles.chips}>
                  <span className={`ds-root ${styles.chip}`} data-theme="light" style={{ background: `var(--color-${kebab(role)})` }} />
                  <span className={`ds-root ${styles.chip}`} data-theme="dark" style={{ background: `var(--color-${kebab(role)})` }} />
                </div>
                <span className={styles.swatchName}>{role}</span>
                <Token>{design.color.light[role]}</Token>
                <Token>{design.color.dark[role]}</Token>
              </div>
            ))}
          </div>
        </Group>
      ))}
      <Group
        title={`Contrast (WCAG 2) · ${failures.length === 0 ? "all pairs pass" : `${failures.length} failing`}`}
        actions={
          failures.length > 0 && (
            <button type="button" className="ask-button" onClick={() => onAsk(`Fix these contrast failures: ${failures.join(", ")}. `)}>
              Ask agent to fix
            </button>
          )
        }
      >
        <div className={styles.contrastTable}>
          <span className={styles.th}>Pair</span>
          <span className={styles.th}>Target</span>
          <span className={styles.th}>Light</span>
          <span className={styles.th}>Dark</span>
          {CONTRAST_PAIRS.map((pair) => (
            <div key={`${pair.fg}-${pair.bg}`} className={styles.contrastRow}>
              <span className={styles.pair}>
                {pair.fg} <span className={styles.on}>on</span> {pair.bg}
              </span>
              <span className={styles.target}>{pair.target}:1</span>
              <Ratio resolved={resolved.light} {...pair} />
              <Ratio resolved={resolved.dark} {...pair} />
            </div>
          ))}
        </div>
      </Group>
    </Section>
  );
}

export function Typography({ design, onAsk }: FoundationProps) {
  const type = design.typography;
  const sizes = Object.entries(type.size).reverse();
  return (
    <Section
      id="typography"
      title="Typography"
      description="Families, a size scale, weights, line heights and tracking. Headings use the display family; interface text uses sans."
      onAsk={onAsk}
    >
      <Group title="Families">
        <div className={styles.families}>
          {(["display", "sans", "mono"] as const).map((family) => (
            <div key={family} className={styles.family} data-ds="font family" data-token={`typography.family.${family}`}>
              <span className={styles.familySample} style={{ fontFamily: `var(--font-${family})` }}>
                Aa Gg 0123
              </span>
              <span className={styles.swatchName}>{family}</span>
              <Token>{type.family[family]}</Token>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Scale">
        <div className={styles.scale}>
          {sizes.map(([key, value]) => (
            <div key={key} className={styles.scaleRow} data-ds="type size" data-token={`typography.size.${key}`}>
              <span className={styles.scaleMeta}>
                <span className={styles.swatchName}>{key}</span>
                <Token>{value}</Token>
              </span>
              <span
                className={styles.scaleSample}
                style={{
                  fontSize: `var(--text-${key})`,
                  fontFamily: ["5xl", "4xl", "3xl", "2xl"].includes(key) ? "var(--font-display)" : undefined,
                }}
              >
                Shape the system, then ship it
              </span>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Weights & tracking">
        <div className={styles.families}>
          {Object.entries(type.weight).map(([key, value]) => (
            <div key={key} className={styles.family}>
              <span className={styles.familySample} style={{ fontWeight: `var(--weight-${key})` }}>
                Basis
              </span>
              <span className={styles.swatchName}>{key}</span>
              <Token>{value}</Token>
            </div>
          ))}
          {Object.entries(type.tracking).map(([key, value]) => (
            <div key={key} className={styles.family}>
              <span className={styles.trackingSample} style={{ letterSpacing: `var(--tracking-${key})` }}>
                {key === "caps" ? "OVERLINE" : "Letterspace"}
              </span>
              <span className={styles.swatchName}>tracking {key}</span>
              <Token>{value}</Token>
            </div>
          ))}
        </div>
      </Group>
      <Group title="In context">
        <article className={styles.prose}>
          <p className={styles.overline}>Release notes</p>
          <h1>A design system you can talk to</h1>
          <p className={styles.lede}>
            Start with a feeling, end with tokens. Every answer from the agent lands in the preview the moment the file is saved.
          </p>
          <h2>Why roles beat raw values</h2>
          <p>
            Components never reference a hex code. They ask for <code>primary</code> or <code>textMuted</code>, so a single change to the palette
            carries through buttons, inputs and alerts at once. Body copy sits at the normal line height; headings tighten up.
          </p>
          <h3>Leading</h3>
          <div className={styles.leading}>
            {Object.entries(type.leading).map(([key, value]) => (
              <p key={key} style={{ lineHeight: `var(--leading-${key})` }}>
                <span className={styles.swatchName}>
                  {key} · {value}
                </span>
                <br />
                Long-form text needs room to breathe, while dense interface labels can sit closer together.
              </p>
            ))}
          </div>
        </article>
      </Group>
    </Section>
  );
}

export function Shape({ design, onAsk }: FoundationProps) {
  return (
    <Section
      id="shape"
      title="Space, shape & depth"
      description="Spacing steps, corner radii, border widths and elevation."
      onAsk={onAsk}
    >
      <Group title="Spacing">
        <div className={styles.spaceList}>
          {Object.entries(design.space).map(([key, value]) => (
            <div key={key} className={styles.spaceRow} data-ds="space" data-token={`space.${key}`}>
              <span className={styles.swatchName}>space-{key}</span>
              <Token>{value}</Token>
              <span className={styles.spaceBar} style={{ width: `var(--space-${key})` }} />
            </div>
          ))}
        </div>
      </Group>
      <Group title="Radius">
        <div className={styles.tiles}>
          {Object.entries(design.radius).map(([key, value]) => (
            <div key={key} className={styles.tileWrap} data-ds="radius" data-token={`radius.${key}`}>
              <span className={styles.radiusTile} style={{ borderRadius: `var(--radius-${key})` }} />
              <span className={styles.swatchName}>{key}</span>
              <Token>{value}</Token>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Elevation">
        <div className={styles.tiles}>
          {Object.entries(design.shadow).map(([key, value]) => (
            <div key={key} className={styles.tileWrap} data-ds="shadow" data-token={`shadow.${key}`}>
              <span className={styles.shadowTile} style={{ boxShadow: `var(--shadow-${key})` }} />
              <span className={styles.swatchName}>shadow-{key}</span>
              <Token>{value}</Token>
            </div>
          ))}
          {Object.entries(design.border).map(([key, value]) => (
            <div key={key} className={styles.tileWrap}>
              <span className={styles.borderTile} style={{ borderWidth: `var(--border-${key})` }} />
              <span className={styles.swatchName}>border-{key}</span>
              <Token>{value}</Token>
            </div>
          ))}
        </div>
      </Group>
    </Section>
  );
}

const BEZIER = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/;

function Curve({ value }: { value: string }) {
  const match = BEZIER.exec(value);
  if (!match) return <span className={styles.curveFallback}>{value.split("(")[0]}</span>;
  const [x1, y1, x2, y2] = match.slice(1).map(Number) as [number, number, number, number];
  const pad = 14;
  const size = 72;
  const px = (x: number) => pad + x * size;
  const py = (y: number) => pad + (1 - y) * size;
  return (
    <svg className={styles.curve} viewBox={`0 0 ${size + pad * 2} ${size + pad * 2}`} aria-hidden>
      <rect x={pad} y={pad} width={size} height={size} className={styles.curveFrame} />
      <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} className={styles.curveHandle} />
      <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} className={styles.curveHandle} />
      <path d={`M${px(0)} ${py(0)} C${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(1)} ${py(1)}`} className={styles.curvePath} />
    </svg>
  );
}

export function Motion({ design, onAsk }: FoundationProps) {
  const [played, setPlayed] = useState(false);
  const play = () => setPlayed((value) => !value);
  return (
    <Section
      id="motion"
      title="Motion"
      description="Durations and easing curves. Press play to run every track; components below use the same tokens for hover, press, enter and exit."
      onAsk={onAsk}
    >
      <Group
        title="Durations · eased with standard"
        actions={
          <Button size="sm" variant="secondary" onClick={play}>
            {played ? "Play back" : "Play"}
          </Button>
        }
      >
        <div className={styles.tracks} data-played={played || undefined}>
          {Object.entries(design.motion.duration).map(([key, value]) => (
            <div key={key} className={styles.trackRow} data-ds="duration" data-token={`motion.duration.${key}`}>
              <span className={styles.scaleMeta}>
                <span className={styles.swatchName}>{key}</span>
                <Token>{value}</Token>
              </span>
              <span className={styles.track}>
                <span
                  className={styles.dot}
                  style={{ transition: `left var(--duration-${key}) var(--ease-standard), translate var(--duration-${key}) var(--ease-standard)` }}
                />
              </span>
            </div>
          ))}
        </div>
      </Group>
      <Group
        title="Easing · over the slow duration"
        actions={
          <Button size="sm" variant="secondary" onClick={play}>
            {played ? "Play back" : "Play"}
          </Button>
        }
      >
        <div className={styles.tracks} data-played={played || undefined}>
          {Object.entries(design.motion.ease).map(([key, value]) => (
            <div key={key} className={styles.easeRow} data-ds="easing" data-token={`motion.ease.${key}`}>
              <Curve value={value} />
              <span className={styles.scaleMeta}>
                <span className={styles.swatchName}>{key}</span>
                <Token>{value}</Token>
              </span>
              <span className={styles.track}>
                <span
                  className={styles.dot}
                  style={{ transition: `left var(--duration-slow) var(--ease-${key}), translate var(--duration-slow) var(--ease-${key})` }}
                />
              </span>
            </div>
          ))}
        </div>
      </Group>
    </Section>
  );
}
