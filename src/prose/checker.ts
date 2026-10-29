// The checks for one page as it changes. Each keeps its paragraphs' results from the last check, so
// an edit checks only the paragraphs it changed.

import { Report } from "./issues";
import { Mistake, punctuationChecker } from "./punctuation";
import { readabilityChecker } from "./readability";

export interface Checker {
  /** Readability: the grade, hard sentences, weakeners, simpler words, and dashes. */
  checkPage(page: string): Report;
  /** Punctuation mistakes. `page` has ghosts blanked out; `raw` is the page as it is. */
  checkPunctuation(page: string, raw: string): Mistake[];
}

/** The checks for one page, or one editor. Two pages that share one would undo each other's savings. */
export function createChecker(): Checker {
  return { checkPage: readabilityChecker(), checkPunctuation: punctuationChecker() };
}
