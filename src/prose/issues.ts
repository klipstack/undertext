// What the checks find: the kinds of marks, each mark, and the report on a page.

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

/** What each kind of mark is called. */
export const KIND_TITLES: Record<Kind, string> = {
  veryHard: "Very hard to read",
  hard: "Hard to read",
  adverb: "Adverb",
  passive: "Passive voice",
  qualifier: "Qualifier",
  intensifier: "Intensifier",
  weakVerb: "Weak verb",
  filler: "Filler",
  hidden: "Hidden action",
  negative: "Negative",
  redundant: "Redundant pair",
  cliche: "Cliché",
  simpler: "Simpler word",
  dash: "Dash",
  dashStyle: "Dash style",
};

/** What to do about each kind of mark, in a line. */
export const KIND_ADVICE: Record<Kind, string> = {
  veryHard: "Split it, or use shorter words.",
  hard: "Split it, or use shorter words.",
  adverb: "An -ly word often props up a weak verb. Cut it if the sentence holds without it.",
  passive: "It hides who acts. “The door was closed” becomes “She closed the door”.",
  qualifier: "It hedges. Say it plainly, or cut it.",
  intensifier: "It tries to add force and rarely does. Cut it, or use a stronger word.",
  weakVerb: "One precise verb says more than a verb and an adverb.",
  filler: "It adds words, not meaning.",
  hidden: "The action hides in a noun. Use the verb.",
  negative: "Say what is, not what isn't.",
  redundant: "One word already says it all.",
  cliche: "Worn smooth by use, it says little. Say what you mean in plain words.",
  simpler: "A plainer word says the same.",
  dash: "One dash, or one pair, per paragraph reads well. Try a comma, a colon, parentheses, or a period.",
  dashStyle: "Write the page's dashes one way.",
};
