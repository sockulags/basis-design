import { useCallback, useEffect, useMemo } from "react";
import { pageById, type FromPreview, type PageId, type PreviewView } from "../../shared/frame.ts";
import { previewCss } from "../../shared/tokens.ts";
import { Impact } from "./Impact.tsx";
import { Review } from "./Review.tsx";
import { clearProblems, setProblem } from "./errors.ts";
import { Colors, Motion, Shape, Typography } from "./Foundations.tsx";
import styles from "./Preview.module.css";
import { findSpecimen } from "./narrow.ts";
import { loadSpecimens, SpecimenSection } from "./specimens.tsx";

/** Introductions under the title of every page but the design system page, which has its own hero. */
const INTROS: Partial<Record<PageId, string>> = {
  patterns:
    "Larger building blocks composed from the base components: navigation, data, forms and whole layouts. They change with every token and every component edit.",
};

interface PreviewProps {
  /** What to show: the page, or the open review instead of it. */
  view: PreviewView;
  /** Sends a message to the chrome: the sections found, "ask the agent" requests, what changed in a review. */
  post: (message: FromPreview) => void;
}

/**
 * The design system specimen. Foundations are Basis' own; every component
 * section comes from a *.specimen.tsx file in the workspace. Everything inside
 * .ds-root is styled only by the generated tokens.
 */
export function Preview({ view, post }: PreviewProps) {
  const { design, theme, page, review } = view;
  const onAsk = useCallback((prefix: string) => post({ type: "ask", prefix }), [post]);
  const onImpact = useCallback((ids: string[]) => post({ type: "impact", ids }), [post]);
  const css = useMemo(() => previewCss(design, ".ds-root"), [design]);
  // Cheap, and re-evaluated after every hot update of a specimen file.
  const { specimens, problems } = loadSpecimens();
  const sectionsKey = specimens
    .map((specimen) => `${specimen.id}|${specimen.title}|${specimen.group}|${specimen.page}`)
    .join(",");
  const onPage = specimens.filter((specimen) => specimen.page === page);
  // Sections the review already shows are not checked again for "also changed" (and rendering them twice
  // more would put their named radio groups in the document three times).
  const shown = new Set((review?.targets ?? []).map((target) => findSpecimen(specimens, target.specimen)?.id ?? ""));
  const problemsKey = problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n");

  useEffect(() => {
    post({
      type: "sections",
      sections: specimens.map(({ id, title, group, page: specimenPage }) => ({ id, title, group, page: specimenPage })),
    });
    // sectionsKey captures everything the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsKey, post]);

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
        {review ? (
          <>
            <Review view={review} specimens={specimens} design={design} theme={theme} onAsk={onAsk} />
            {review.baseline && (
              <Impact
                baseline={review.baseline}
                specimens={specimens.filter((specimen) => !shown.has(specimen.id))}
                design={design}
                theme={theme}
                onImpact={onImpact}
              />
            )}
          </>
        ) : (
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
        )}
      </div>
    </>
  );
}
