// Sentences in plain text, and the words in them.

export interface Span {
  from: number;
  to: number;
}

/** A word: letters and digits, with apostrophes and hyphens inside. */
export const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "cf", "approx", "dept", "inc", "ltd", "mt"]);
/** Abbreviations that are also words, such as "no": they only count before a number, as in "No. 5". */
const BEFORE_NUMBERS = new Set(["no", "fig", "vol", "p", "pp", "ch", "sec"]);

/** Where each sentence starts and ends in `text`, without the space around it. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  const push = (to: number) => {
    const from = start + (text.slice(start, to).length - text.slice(start, to).trimStart().length);
    if (from < to && WORD.test(text.slice(from, to))) out.push({ from, to });
    WORD.lastIndex = 0;
    start = to;
  };
  for (const m of text.matchAll(/[.!?]+["'”’)\]*_]*(?=\s|$)/g)) {
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 8);
    // "p.m. on": the sentence goes on.
    if (/^\s+\p{Ll}/u.test(after)) continue;
    if (m[0][0] === "." && m[0].length === 1) {
      const token = (/[\p{L}.]+$/u.exec(text.slice(Math.max(start, m.index - 12), m.index))?.[0] ?? "").toLowerCase();
      // "Mr. Smith", "No. 5", "J. K. Rowling", "e.g. This".
      if (ABBREVIATIONS.has(token) || (BEFORE_NUMBERS.has(token) && /^\s+\d/.test(after))) continue;
      if (token.length === 1 || token.includes(".")) continue;
    }
    push(end);
  }
  push(text.trimEnd().length);
  return out;
}
