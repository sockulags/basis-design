import { useMemo } from "react";
import type { Design } from "../../shared/design.ts";
import { previewCss } from "../../shared/tokens.ts";
import { Buttons, Feedback, Inputs, Navigation, Overlays, Selection, Surfaces } from "./Components.tsx";
import { Colors, Motion, Shape, Typography } from "./Foundations.tsx";
import styles from "./Preview.module.css";

export const SECTIONS = [
  { id: "color", label: "Color" },
  { id: "typography", label: "Type" },
  { id: "shape", label: "Shape" },
  { id: "motion", label: "Motion" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs" },
  { id: "selection", label: "Selection" },
  { id: "feedback", label: "Feedback" },
  { id: "navigation", label: "Tabs" },
  { id: "surfaces", label: "Cards" },
  { id: "overlays", label: "Overlays" },
] as const;

interface PreviewProps {
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
}

/** The design system specimen. Everything inside .ds-root is styled only by the generated tokens. */
export function Preview({ design, theme, onAsk }: PreviewProps) {
  const css = useMemo(() => previewCss(design, ".ds-root"), [design]);
  const props = { design, onAsk };
  return (
    <>
      <style>{css}</style>
      {design.typography.fontImports.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <div className={`ds-root ${styles.root}`} data-theme={theme}>
        <div className={styles.inner}>
          <header className={styles.hero}>
            <p className={styles.kicker}>Design system</p>
            <h1 className={styles.title}>{design.name}</h1>
            {design.description && <p className={styles.description}>{design.description}</p>}
          </header>
          <Colors {...props} />
          <Typography {...props} />
          <Shape {...props} />
          <Motion {...props} />
          <Buttons {...props} />
          <Inputs {...props} />
          <Selection {...props} />
          <Feedback {...props} />
          <Navigation {...props} />
          <Surfaces {...props} />
          <Overlays {...props} />
        </div>
      </div>
    </>
  );
}
