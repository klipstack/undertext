// What the checks find: the kinds of marks, each mark, and the report on a page.

// "grammar" comes from Claude, on request (src/ai/tasks.ts). The rest come from here.
export const KINDS = [
  "veryHard",
  "hard",
  "adverb",
  "passive",
  "qualifier",
  "intensifier",
  "weakVerb",
  "filler",
  "hidden",
  "negative",
  "redundant",
  "cliche",
  "simpler",
  "dash",
  "dashStyle",
  "grammar",
] as const;
export type Kind = (typeof KINDS)[number];

export interface Issue {
  from: number;
  to: number;
  kind: Kind;
  /** Why it's marked, e.g. "Very hard to read. 38 words." */
  note: string;
  /** Text that could replace it, in its form and case, e.g. "strolled" for "walked slowly". */
  fix?: string;
}

export interface Report {
  /** In page order. A sentence comes before the words marked inside it. */
  issues: Issue[];
  /** Weakener marks, each counted once: "really" is an intensifier and an adverb, but one mark. */
  weakeners: number;
  /** Counts for the prose only: no headings, code, or link addresses. */
  words: number;
  letters: number;
  sentences: number;
  /** The page's grade, or null when it has no prose. */
  grade: number | null;
}
