import { describeDraft, type NoteDraft } from "./lib/note-draft";

export type { NoteDraft };

/**
 * What the Lesson Note editor shows for the text in its box: the character
 * count against the limit, whether it differs from the saved Note, and
 * whether Save is worth pressing.
 */
export function describeNoteDraft(
  draft: string,
  savedBody: string | null
): NoteDraft {
  return describeDraft(draft, savedBody);
}
