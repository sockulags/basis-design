import { useCallback, useEffect, useMemo, useState } from "react";
import { pageById, type FromPreview, type PageId, type PreviewView } from "../../shared/frame.ts";
import { previewCss } from "../../shared/tokens.ts";
import { FrameBar, useFrameChoice } from "./FrameBar.tsx";
import { FullScreenLayer, useFullScreen } from "./FullScreen.tsx";
import { Impact } from "./Impact.tsx";
import { Review } from "./Review.tsx";
import { contrastFailures } from "../../shared/contrast.ts";
import { scheduleDemoChecks } from "./a11y.ts";
import { useResolvedColors } from "./color.ts";
import { clearProblems, onHotUpdate, setFindings, setProblem } from "./errors.ts";
import { Colors, Motion, Shape, Typography } from "./Foundations.tsx";
import styles from "./Preview.module.css";
import { findSpecimen } from "./narrow.ts";
import { onReveal, useProgressiveCount } from "./progressive.ts";
import { loadSpecimens, SpecimenSection } from "./specimens.tsx";

/** Introductions under the title of every page but the design system page, which has its own hero. */
const INTROS: Partial<Record<PageId, string>> = {
  patterns:
    "Larger building blocks composed from the base components: navigation, data, forms and whole layouts. They change with every token and every component edit.",
  views:
    "Whole screens of a product's flows, built from the patterns and components. Click through them, or jump to a screen from the strip above it.",
};

interface PreviewProps {
  /** What to show: the page, or the open review instead of it. */
  view: PreviewView;
  /** Sends a message to the chrome: the sections found, "ask the agent" requests, what changed in a review. */
  post: (message: FromPreview) => void;
  /** The hidden copy in the other theme, which only runs the checks of the demos: it skips what else a review shows. */
  themeCheck?: boolean;
}

/**
 * The design system specimen. Foundations are Basis' own; every component
 * section comes from a *.specimen.tsx file in the workspace. Everything inside
 * .ds-root is styled only by the generated tokens.
 */
export function Preview({ view, post, themeCheck = false }: PreviewProps) {
  const { design, theme, page, review } = view;
  // A view alone over everything else; the copy in the other theme never shows one.
  const fullScreen = useFullScreen(themeCheck ? null : view.fullscreen, theme, post);
  const { open, left, exit } = fullScreen;
  const flows = useMemo(() => (themeCheck ? undefined : { open, left }), [themeCheck, open, left]);
  const onAsk = useCallback((prefix: string) => post({ type: "ask", prefix }), [post]);
  const onImpact = useCallback((ids: string[]) => post({ type: "impact", ids }), [post]);
  const css = useMemo(() => previewCss(design, ".ds-root"), [design]);
  // Contrast is checked on every page, since every page uses the colours.
  const colors = useResolvedColors(design);
  useEffect(() => setFindings("Contrast", contrastFailures(colors)), [colors]);
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
  // Widths and themes for every block, chosen in the bar above the sections.
  const [frameChoice, setFrameChoice] = useFrameChoice();
  // The copy in the other theme also shows every block at phone width, so the layout check always covers a phone
  // whatever widths the user looks at.
  const frames = useMemo(
    () => ({
      ...frameChoice,
      widths:
        themeCheck && !frameChoice.widths.includes("mobile")
          ? [...frameChoice.widths, "mobile" as const]
          : frameChoice.widths,
      theme,
    }),
    [frameChoice, theme, themeCheck],
  );
  // Large pages render their first screen at once and the rest in steps (see progressive.ts).
  const [rendered, reveal] = useProgressiveCount(onPage.length, page);
  const pageIds = onPage.map((specimen) => specimen.id).join(",");
  useEffect(
    () =>
      onReveal((id) => {
        const index = pageIds.split(",").indexOf(id);
        if (index !== -1) reveal(index);
      }),
    [pageIds, reveal],
  );

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

  // Anything that changes what the live demos render asks for the checks once things settle.
  const [hotVersion, setHotVersion] = useState(0);
  useEffect(() => onHotUpdate(() => setHotVersion((value) => value + 1)), []);
  useEffect(() => scheduleDemoChecks(), [design, theme, page, review, rendered, frames, sectionsKey, hotVersion]);

  const props = { design, onAsk };
  const inFullScreen = fullScreen.shown && specimens.find((specimen) => specimen.id === fullScreen.shown?.specimen);
  // A view the agent removed while it was in full screen leaves it.
  const gone = Boolean(fullScreen.shown && !inFullScreen);
  useEffect(() => {
    if (gone) exit();
  }, [gone, exit]);
  return (
    <>
      <style>{css}</style>
      {design.typography.fontImports.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <div className={`ds-root ${styles.root}`} data-theme={theme}>
        {review ? (
          <>
            <Review
              view={review}
              specimens={specimens}
              design={design}
              theme={theme}
              onAsk={onAsk}
              alsoPhone={themeCheck}
            />
            {review.baseline && !themeCheck && (
              <Impact
                baseline={review.baseline}
                specimens={specimens.filter(
                  (specimen) => !shown.has(specimen.id) && (!review.reach || review.reach.includes(specimen.file)),
                )}
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
            {onPage.length > 0 && <FrameBar choice={frameChoice} onChange={setFrameChoice} />}
            {onPage.map((specimen, index) =>
              index < rendered ? (
                <SpecimenSection
                  key={specimen.id}
                  specimen={specimen}
                  design={design}
                  onAsk={onAsk}
                  frames={frames}
                  fullScreen={flows}
                />
              ) : (
                <section key={specimen.id} id={specimen.id} className={styles.pending} aria-busy="true">
                  <h2>{specimen.title}</h2>
                </section>
              ),
            )}
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
      {fullScreen.shown && inFullScreen && (
        <FullScreenLayer
          specimen={inFullScreen}
          place={fullScreen.shown}
          design={design}
          onAsk={onAsk}
          onMove={fullScreen.move}
          onTheme={fullScreen.setTheme}
          onExit={exit}
        />
      )}
    </>
  );
}
