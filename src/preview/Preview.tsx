import { useEffect, useMemo } from "react";
import type { Design } from "../../shared/design.ts";
import { pageById, type NavSection, type PageId } from "../../shared/frame.ts";
import { previewCss } from "../../shared/tokens.ts";
import { clearProblems, setProblem } from "./errors.ts";
import { Colors, Motion, Shape, Typography } from "./Foundations.tsx";
import styles from "./Preview.module.css";
import { loadSpecimens, SpecimenSection } from "./specimens.tsx";

/** Introductions under the title of every page but the design system page, which has its own hero. */
const INTROS: Partial<Record<PageId, string>> = {
  patterns:
    "Larger building blocks composed from the base components: navigation, data, forms and whole layouts. They change with every token and every component edit.",
};

interface PreviewProps {
  design: Design;
  theme: "light" | "dark";
  page: PageId;
  onAsk: (prefix: string) => void;
  /** Called with the sections of every page whenever the set of specimens changes. */
  onSections: (sections: NavSection[]) => void;
}

/**
 * The design system specimen. Foundations are Basis' own; every component
 * section comes from a *.specimen.tsx file in the workspace. Everything inside
 * .ds-root is styled only by the generated tokens.
 */
export function Preview({ design, theme, page, onAsk, onSections }: PreviewProps) {
  const css = useMemo(() => previewCss(design, ".ds-root"), [design]);
  // Cheap, and re-evaluated after every hot update of a specimen file.
  const { specimens, problems } = loadSpecimens();
  const sectionsKey = specimens.map((specimen) => `${specimen.id}|${specimen.title}|${specimen.group}|${specimen.page}`).join(",");
  const onPage = specimens.filter((specimen) => specimen.page === page);
  const problemsKey = problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n");

  useEffect(() => {
    onSections(specimens.map(({ id, title, group, page: specimenPage }) => ({ id, title, group, page: specimenPage })));
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
          {page === "system" ? (
            <>
              <header className={styles.hero}>
                <p className={styles.kicker}>Design system</p>
                <h1 className={styles.title}>{design.name}</h1>
                {design.description && <p className={styles.description}>{design.description}</p>}
              </header>
              <Colors {...props} />
              <Typography {...props} />
              <Shape {...props} />
              <Motion {...props} />
            </>
          ) : (
            <header className={styles.hero}>
              <p className={styles.kicker}>{design.name}</p>
              <h1 className={styles.title}>{pageById(page).label}</h1>
              {INTROS[page] && <p className={styles.description}>{INTROS[page]}</p>}
            </header>
          )}
          {onPage.map((specimen) => (
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
