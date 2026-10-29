// Sentences in plain text, and the words in them.

export interface Span {
  from: number;
  to: number;
}

/** A word: letters and digits, with apostrophes and hyphens inside. */
export const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Abbreviations that never end a sentence: titles before a name, and "e.g." before an example. */
const NEVER_LAST = new Set(
  "mr mrs ms dr prof rev hon pres gen sen rep gov capt lt col sgt maj adm mt vs cf e.g i.e approx".split(" "),
);
/** Abbreviations that may end one, as an initial or a dotted word may: "Acme Inc.", "in Sept.", "the U.S." */
const MAY_BE_LAST = new Set(
  "sr jr st dept inc ltd co corp bros ave blvd rd jan feb mar apr jun jul aug sep sept oct nov dec".split(" "),
);
/** Abbreviations that are also words, such as "no": they only count before a number, as in "No. 5". */
const BEFORE_NUMBERS = new Set(["no", "fig", "vol", "p", "pp", "ch", "sec"]);
/** Words that often open a sentence, and rarely follow an initial or an abbreviation in one. */
const OPENER =
  /^\s+["“(]?(?:The|A|An|It|Its|He|She|They|We|I|You|This|That|These|Those|There|Then|But|And|So|Yet|Or|If|When|While|After|Before|In|On|At|For|As|My|Our|Your|His|Her|Their|One|Some|Most|Each|However|Now|Later|Today|What|Why|How|Who|Where)(?![\p{L}\p{N}.'’-])/u;

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
  for (const m of text.matchAll(/[.!?…]+["'”’)\]*_]*(?=\s|$)/g)) {
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 12);
    // "p.m. on": the sentence goes on.
    if (/^\s+\p{Ll}/u.test(after)) continue;
    if (m[0][0] === "." && m[0].length === 1) {
      const token = (/[\p{L}.]+$/u.exec(text.slice(Math.max(start, m.index - 12), m.index))?.[0] ?? "").toLowerCase();
      // "Mr. Smith", "No. 5", "e.g. The Who".
      if (NEVER_LAST.has(token) || (BEFORE_NUMBERS.has(token) && /^\s+\d/.test(after))) continue;
      // "J. K. Rowling" and "Jan. 5" go on; "an A. Then" and "the U.S. She" end.
      if ((MAY_BE_LAST.has(token) || token.length === 1 || token.includes(".")) && !OPENER.test(after)) continue;
    }
    push(end);
  }
  push(text.trimEnd().length);
  return out;
}
