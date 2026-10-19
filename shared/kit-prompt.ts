import { KIT_FOLDER } from "./capture.ts";

/*
 * The short prompt the Export tab's "Copy prompt" puts on the clipboard, for the agent that builds the design in
 * the product: where the kit is, which views to build, and to follow the kit's PROMPT.md. The details live in the
 * kit, so this stays a few lines the user can paste anywhere.
 */

export interface KitPromptOptions {
  views: { id: string; title: string }[];
  /** The one view to build; all of them when absent. */
  view?: string;
  /** True when the kit was built as a zip, which the user unpacks themselves. */
  zip: boolean;
}

export function kitPrompt({ views, view, zip }: KitPromptOptions): string {
  const chosen = views.find((item) => item.id === view);
  const named = (item: { id: string; title: string }) => `"${item.title}" (${item.id})`;
  const where = zip
    ? `Basis' verification kit for this design is in \`${KIT_FOLDER}/\` at the root of this repo, unpacked from the .zip Basis built. If it is somewhere else, use the folder that holds PROMPT.md and basis-verify.json, and read the paths in it from there.`
    : `Basis wrote a verification kit for this design into \`${KIT_FOLDER}/\` at the root of this repo.`;
  const what = chosen
    ? `Build the view ${named(chosen)} in this product so that it matches the design.`
    : `Build the views it holds in this product so that they match the design: ${views.map(named).join(", ")}.`;
  const read = chosen
    ? `Read \`${KIT_FOLDER}/PROMPT.md\` and the view's notes in \`${KIT_FOLDER}/views/${chosen.id}.md\` first, and follow them.`
    : `Read \`${KIT_FOLDER}/PROMPT.md\` first and follow it.`;
  return [
    where,
    "",
    what,
    "",
    `${read} Work in the loop it describes (capture the design and the product, compare, read the diffs, fix) until every shot passes or it says to stop, then report the result of each shot.`,
  ].join("\n");
}
