/**
 * The preview holds the workspace's changes while an agent turn runs (server/hold.ts) and shows them when it ends.
 * The preview server tells its pages over Vite's HMR channel; these are the names both sides use.
 */

/** Sent when a turn starts: the gallery stops taking updates until the release. */
export const HOLD_EVENT = "basis:hold";
/** Sent when a turn ends; with `reload`, something changed meanwhile and the gallery reloads once. */
export const RELEASE_EVENT = "basis:release";

export interface ReleasePayload {
  reload: boolean;
}

/** The meta tag the preview server adds to every gallery document it serves: its generation, and whether a turn holds it. */
export const HOLD_META = "basis-preview";

export interface HoldState {
  /** How many times the gallery has been reloaded after a turn; a document knows the one it was served in. */
  generation: number;
  held: boolean;
}

export function holdMeta(state: HoldState): string {
  return JSON.stringify(state);
}

/** Reads the meta tag's content; a document without one (or a garbled one) is generation 0 and not held. */
export function readHoldMeta(content: string | null | undefined): HoldState {
  try {
    const value = JSON.parse(content ?? "") as Partial<HoldState> | null;
    const generation = value?.generation;
    return {
      generation: Number.isSafeInteger(generation) && (generation as number) >= 0 ? (generation as number) : 0,
      held: value?.held === true,
    };
  } catch {
    return { generation: 0, held: false };
  }
}
