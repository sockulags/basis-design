/*
 * Views made for an issue in a tracker (Jira's WEB-12, GitHub's owner/repo#42, a card key in a pipeline) are named
 * for it: the issue's key starts the view's title, and the view's id is the key in kebab-case. Everything that
 * finds the view later (the kit's folder basis-verify/<id>/, the API) goes by that id.
 */

/** An issue key as given, trimmed, or null when it is not one: letters, digits and `-_.#/`, at most 64 long. */
export function issueKey(text: string): string | null {
  const key = text.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.#/-]{0,63}$/.test(key) && /[A-Za-z0-9]$/.test(key) ? key : null;
}

/** The id of the view for an issue: `WEB-12` gives `web-12`, `owner/repo#42` gives `owner-repo-42`. */
export function issueViewId(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
