import { useEffect, useMemo } from "react";
import type { Design } from "../../shared/design.ts";
import type { NavSection } from "../../shared/frame.ts";
import { previewCss } from "../../shared/tokens.ts";
import { clearProblems, setProblem } from "./errors.ts";
import { Colors, Motion, Shape, Typography } from "./Foundations.tsx";
import styles from "./Preview.module.css";
import { loadSpecimens, SpecimenSection } from "./specimens.tsx";

interface PreviewProps {
  design: Design;
  theme: "light" | "dark";
  onAsk: (prefix: string) => void;
  /** Called with the component sections whenever the set of specimens changes. */
  onSections: (sections: NavSection[]) => void;
}

/**
 * The design system specimen. Foundations are Basis' own; every component
 * section comes from a *.specimen.tsx file in the workspace. Everything inside
 * .ds-root is styled only by the generated tokens.
 */
export function Preview({ design, theme, onAsk, onSections }: PreviewProps) {
  const css = useMemo(() => previewCss(design, ".ds-root"), [design]);
  // Cheap, and re-evaluated after every hot update of a specimen file.
  const { specimens, problems } = loadSpecimens();
  const sectionsKey = specimens.map((specimen) => `${specimen.id}|${specimen.title}|${specimen.group}`).join(",");
  const problemsKey = problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n");

  useEffect(() => {
    onSections(specimens.map(({ id, title, group }) => ({ id, title, group })));
    // sectionsKey captures everything the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsKey, onSections]);

  useEffect(() => {
    clearProblems("Specimen ");
    for (const problem of problems) setProblem(`Specimen ${problem.file}`, problem.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemsKey]);

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
          {specimens.map((specimen) => (
            <SpecimenSection key={specimen.id} specimen={specimen} design={design} onAsk={onAsk} />
          ))}
          {problems.map((problem) => (
            <div key={problem.file + problem.message} className="section-error" role="alert">
              <strong>{problem.file} could not be shown</strong>
              <code>{problem.message}</code>
              <button
                type="button"
                className="ask-button"
                onClick={() => onAsk(`${problem.file} cannot be shown in the gallery (${problem.message}). Fix it. `)}
              >
                Ask agent to fix
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
