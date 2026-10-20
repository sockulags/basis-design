import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { pageById, type FromPreview, type PageId, type PreviewView } from "../../shared/frame.ts";
import { previewCss } from "../../shared/tokens.ts";
import type { Widths } from "../../shared/widths.ts";
import { FrameBar, useFrameChoice } from "./FrameBar.tsx";
import { FullScreenLayer, useFullScreen } from "./FullScreen.tsx";
import { Impact } from "./Impact.tsx";
import { Review } from "./Review.tsx";
import { contrastFailures } from "../../shared/contrast.ts";
import { scheduleDemoChecks } from "./a11y.ts";
import { useResolvedColors } from "./color.ts";
import { clearProblems, onHotUpdate, setFindings, setProblem } from "./errors.ts";
import { Colors, FOUNDATION_TEXT, Motion, Shape, Typography } from "./Foundations.tsx";
import { entryMeta, FOUNDATION_PICTURES, Overview, type PageEntry } from "./Overview.tsx";
import overview from "./Overview.module.css";
import styles from "./Preview.module.css";
import { findSpecimen } from "./narrow.ts";
import { onReveal, useProgressiveCount } from "./progressive.ts";
import { loadSpecimens, ProjectWidths, SpecimenSection } from "./specimens.tsx";

/** Introductions under the title of every page but the design system page, which has its own hero. */
const INTROS: Partial<Record<PageId, string>> = {
  patterns:
    "Larger building blocks composed from the base components: navigation, data, forms and whole layouts. They change with every token and every component edit.",
  views:
    "Whole screens of a product's flows, built from the patterns and components. Click through them, or jump to a screen from the strip above it.",
};

/** Basis' own sections of the design system page, before the components. */
const FOUNDATIONS = [
  { id: "color", Component: Colors },
  { id: "typography", Component: Typography },
  { id: "shape", Component: Shape },
  { id: "motion", Component: Motion },
] as const;

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
  const { design, theme, page, review, widths } = view;
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
  useEffect(
    () => scheduleDemoChecks(),
    [design, theme, page, review, rendered, frames, widths, sectionsKey, hotVersion],
  );
  // The project's widths, changed from the control next to Show at; the chrome passes them on to Basis.
  const onWidths = useCallback((next: Widths | null) => post({ type: "widths-set", widths: next }), [post]);

  const props = { design, onAsk };
  // The page's sections as entries: an overview shows them as cards, and each can be shown alone.
  const entries: PageEntry[] = [
    ...(page === "system"
      ? FOUNDATIONS.map(({ id }) => ({
          id,
          group: "Foundations",
          ...FOUNDATION_TEXT[id],
          picture: FOUNDATION_PICTURES[id],
        }))
      : []),
    ...onPage.map((specimen) => ({
      id: specimen.id,
      title: specimen.title,
      group: specimen.group,
      description: specimen.description ?? "",
      specimen,
      meta: entryMeta(specimen),
    })),
  ];
  const focusIndex = view.focus ? entries.findIndex((entry) => entry.id === view.focus) : -1;
  const focused = entries[focusIndex];
  // The hidden copies always show the whole page, so the checks cover all of it.
  const mode = view.all || themeCheck ? "all" : focused ? "one" : "overview";
  const navigate = (focus: string | null, all = false) => post({ type: "navigate", focus, ...(all ? { all } : {}) });
  const inFullScreen = fullScreen.shown && specimens.find((specimen) => specimen.id === fullScreen.shown?.specimen);
  // A view the agent removed while it was in full screen leaves it.
  const gone = Boolean(fullScreen.shown && !inFullScreen);
  useEffect(() => {
    if (gone) exit();
  }, [gone, exit]);
  return (
    <ProjectWidths.Provider value={widths}>
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
            {mode === "one" && focused ? (
              <One
                entry={focused}
                previous={entries[focusIndex - 1]}
                next={entries[focusIndex + 1]}
                pageLabel={pageById(page).label}
                onNavigate={navigate}
              >
                {focused.specimen ? (
                  <>
                    <FrameBar choice={frameChoice} onChange={setFrameChoice} widths={widths} onWidths={onWidths} />
                    <SpecimenSection
                      specimen={focused.specimen}
                      design={design}
                      onAsk={onAsk}
                      frames={frames}
                      fullScreen={flows}
                    />
                  </>
                ) : (
                  FOUNDATIONS.filter(({ id }) => id === focused.id).map(({ id, Component }) => (
                    <Component key={id} {...props} />
                  ))
                )}
              </One>
            ) : page === "system" ? (
              <>
                <header className={styles.hero}>
                  <p className={styles.kicker}>Design system</p>
                  <h1 className={styles.title}>{design.name}</h1>
                  {design.description && <p className={styles.description}>{design.description}</p>}
                  <ModeSwitch all={mode === "all"} onNavigate={navigate} hidden={themeCheck} />
                </header>
                {mode === "all" && FOUNDATIONS.map(({ id, Component }) => <Component key={id} {...props} />)}
              </>
            ) : (
              <header className={styles.hero}>
                <p className={styles.kicker}>{design.name}</p>
                <h1 className={styles.title}>{pageById(page).label}</h1>
                {INTROS[page] && <p className={styles.description}>{INTROS[page]}</p>}
                <ModeSwitch all={mode === "all"} onNavigate={navigate} hidden={themeCheck} />
              </header>
            )}
            {mode === "overview" && <Overview entries={entries} design={design} onOpen={(id) => navigate(id)} />}
            {mode === "all" && onPage.length > 0 && (
              <FrameBar choice={frameChoice} onChange={setFrameChoice} widths={widths} onWidths={onWidths} />
            )}
            {mode === "all" &&
              onPage.map((specimen, index) =>
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
    </ProjectWidths.Provider>
  );
}

/** Below a page's title: the page as cards, or everything on it in turn. */
function ModeSwitch({
  all,
  onNavigate,
  hidden,
}: {
  all: boolean;
  onNavigate: (focus: string | null, all?: boolean) => void;
  hidden: boolean;
}) {
  if (hidden) return null;
  return (
    <button type="button" className={overview.viewToggle} onClick={() => onNavigate(null, !all)}>
      {all ? "Show as cards" : "Show all on one page"}
    </button>
  );
}

/** One section on its own: the way back to the page's cards above it, and the sections either side below. */
function One({
  entry,
  previous,
  next,
  pageLabel,
  onNavigate,
  children,
}: {
  entry: PageEntry;
  previous: PageEntry | undefined;
  next: PageEntry | undefined;
  pageLabel: string;
  onNavigate: (focus: string | null) => void;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className={overview.back} onClick={() => onNavigate(null)}>
        <span aria-hidden="true">←</span> {pageLabel}
      </button>
      {children}
      {(previous || next) && (
        <nav className={overview.pager} aria-label={`Next to ${entry.title}`}>
          {previous && (
            <button type="button" onClick={() => onNavigate(previous.id)}>
              <small>Previous</small>
              {previous.title}
            </button>
          )}
          {next && (
            <button type="button" onClick={() => onNavigate(next.id)}>
              <small>Next</small>
              {next.title}
            </button>
          )}
        </nav>
      )}
    </>
  );
}
