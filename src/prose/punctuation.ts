// Punctuation mistakes, most with one right fix, found in plain text as you write: a space before
// punctuation or none after it, doubled punctuation or words, hyphens for a dash, a hyphen after an
// -ly adverb, a bracket or quote with no partner, and a decade with an apostrophe. The rules are for
// English. No editor code, so the tests run on plain strings.

import { DASHES, DashStyle, dashStyle, isRange, LY_WORDS, proseBlocks } from "./readability";

export { dashStyle, type DashStyle };

/** Text the rules skip, such as code or a ghost, stands in as this character, so no rule reads across it. */
export const SKIPPED = "\uFFFC";

export interface Mistake {
  from: number;
  to: number;
  /** What's wrong, e.g. "A space before the comma." */
  note: string;
  /** The text in place of from–to, or none when only the writer can tell, as for a lone bracket. */
  fix?: string;
  /** An opening bracket or quote with no partner yet: the writer may be about to type it. */
  opens?: true;
}

const NAMES: Record<string, string> = {
  ",": "comma",
  ".": "period",
  ";": "semicolon",
  ":": "colon",
  "!": "exclamation mark",
  "?": "question mark",
};

/** Words that are often doubled on purpose: "had had", "that that", "her her book", "bye bye". */
const DOUBLES = new Set(
  (
    "had that is was do her long much far bye ha ho hee no so yeah yes well now there very really oh ah aye ok " +
    "okay hey wow knock chop night boo tut tsk la blah bang tick hip yada wink nudge"
  ).split(" "),
);

/** Adjectives that end in -ly, which a hyphen may follow: "friendly-looking", "scholarly-minded". */
const LY_ADJECTIVES = new Set(
  (
    "manly womanly scholarly orderly cowardly sickly worldly stately timely homely comely kingly motherly " +
    "fatherly brotherly sisterly neighborly neighbourly heavenly ghostly beastly bodily leisurely lowly " +
    "deathly masterly miserly princely saintly shapely unruly wobbly bubbly prickly wrinkly burly surly " +
    "gnarly pearly smelly woolly frilly measly grisly grizzly gully telly dully steely pimply gravelly ghastly " +
    "spindly " +
    // The first halves of "willy-nilly", "dilly-dally", "shilly-shally", "roly-poly", "hurly-burly".
    "willy dilly shilly roly hurly"
  ).split(" "),
);

const SPACE = /[\s\uFFFC]/;



/** Mistakes in one block of prose. Offsets are in `text`; skipped text is SKIPPED. */
export function punctuationIn(text: string, style: DashStyle): Mistake[] {
  const found: Mistake[] = [];
  /** Where the word ending at `end` starts: no space, no skipped text. */
  const start = (end: number) => {
    let i = end;
    while (i > 0 && !SPACE.test(text[i - 1])) i--;
    return i;
  };
  /** Where the word starting at `from` ends. */
  const end = (from: number) => {
    let i = from;
    while (i < text.length && !SPACE.test(text[i])) i++;
    return i;
  };
  const add = (from: number, to: number, note: string, fix?: string) => found.push({ from, to, note, ...(fix === undefined ? {} : { fix }) });

  // A space before punctuation: "said ,". Not an ellipsis, a decimal, a smiley, or "3 : 2".
  for (const m of text.matchAll(/(?<=[^\s\uFFFC])([ \t]+)([,.;:!?]+)(?=[\s"”’'*_~]|$)/g)) {
    const marks = m[2];
    const after = text.slice(m.index + m[0].length);
    if (marks.includes("..")) continue;
    // A spaced ellipsis: ". . .".
    if (marks === "." && (text[m.index - 1] === "." || /^[ \t]+\./.test(after))) continue;
    if (marks === ":" && /\d/.test(text[m.index - 1] ?? "") && /^\s*\d/.test(after)) continue;
    const from = start(m.index);
    const fix = text.slice(from, m.index) + marks.replace(/([,;])\1+/g, "$1");
    add(from, m.index + m[0].length, `A space before the ${NAMES[marks[0]]}.`, fix);
  }

  // No space after a comma or semicolon between letters: "red,green". Not in an address or a handle.
  for (const m of text.matchAll(/(?<=\p{L})[,;](?=\p{L})/gu)) {
    const from = start(m.index);
    const to = end(m.index + 1);
    if (/[/@=:#]/.test(text.slice(from, to))) continue;
    add(from, to, `No space after the ${NAMES[m[0]]}.`, `${text.slice(from, m.index + 1)} ${text.slice(m.index + 1, to)}`);
  }

  // No space after the end of a sentence: "fine.Then". Not "e.g.The", "U.S.Army", "Node.js", or
  // "Console.WriteLine".
  for (const m of text.matchAll(/(?<=\p{Ll}{2})[.!?](?=\p{Lu}\p{Ll})/gu)) {
    const from = start(m.index);
    const to = end(m.index + 1);
    if (/[/@=:#]/.test(text.slice(from, to)) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(text.slice(m.index + 1, to))) continue;
    add(from, to, `No space after the ${NAMES[m[0]]}.`, `${text.slice(from, m.index + 1)} ${text.slice(m.index + 1, to)}`);
  }

  // Doubled punctuation: ",," and "..", but not an ellipsis or "../".
  for (const m of text.matchAll(/(?<!,),,(?!,)|(?<!;);;(?!;)|(?<![.\d])\.\.(?![./\d])/g)) {
    const from = start(m.index);
    const name = { ",": "commas", ";": "semicolons", ".": "periods" }[m[0][0]]!;
    add(from, m.index + 2, `Two ${name}.`, text.slice(from, m.index) + m[0][0]);
  }

  // A doubled word: "the the". Not "had had", or a name such as "Bora Bora".
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'’-])(\p{L}+)[ \t]+\1(?![\p{L}\p{N}'’-])/giu)) {
    const [whole, first] = m;
    const second = whole.slice(-first.length);
    if (DOUBLES.has(second.toLowerCase()) || (/^\p{Lu}/u.test(first) && /^\p{Lu}/u.test(second))) continue;
    add(m.index, m.index + whole.length, "The same word twice.", first);
  }

  // Hyphens for a dash: "word--word", "word -- word", "word - word". Not "---", a "--flag", "5 - 3",
  // or the start of a line.
  const dash = DASHES[style];
  for (const m of text.matchAll(/(?<!-)--(?!-)|(?<=[^\s\uFFFC-])[ \t]+-[ \t]+(?=[^\s\uFFFC-])/g)) {
    let a = m.index;
    while (a > 0 && (text[a - 1] === " " || text[a - 1] === "\t")) a--;
    let b = m.index + m[0].length;
    while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
    const before = text[a - 1];
    const after = text[b];
    if (before === undefined || SPACE.test(before) || after === SKIPPED) continue;
    const pair = m[0].trim() === "--";
    if (pair && a < m.index && b === m.index + 2 && after && /\p{L}/u.test(after)) continue;
    // An arrow: "-->" and "<--".
    if (pair && (text[m.index + 2] === ">" || text[m.index - 1] === "<")) continue;
    const from = start(a);
    const left = text.slice(from, a);
    // At the end of a sentence, as in "I was going to--", the dash has nothing after it. A straight
    // quote closes only before a space or the end.
    const closes = /[”’)\]]/.test(after ?? "") || (/["']/.test(after ?? "") && /^.(?:[\s.,;:!?]|$)/.test(text.slice(b)));
    if (after === undefined || after === "\n" || closes) {
      add(from, m.index + m[0].trimEnd().length, pair ? "Two hyphens for a dash." : "A hyphen for a dash.", left + dash.trimEnd());
      continue;
    }
    const to = end(b);
    const right = text.slice(b, to);
    // Numbers, hours, days, and months make a range. Two hyphens between numbers become an en dash.
    const range = isRange(left, right);
    if (range && pair && /\d$/.test(left) && /^\d/.test(right)) add(from, to, "Two hyphens for a range.", `${left}–${right}`);
    else if (!range) add(from, to, pair ? "Two hyphens for a dash." : "A hyphen for a dash.", left + dash + right);
  }

  // A hyphen after an -ly adverb: "highly-rated". Not "family-owned" or "friendly-looking", and not
  // a capitalized word, which may be a name.
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'’-])(\p{Ll}{2,}ly)-(\p{L}+)(?![\p{L}\p{N}]|['’]\p{L})/gu)) {
    const word = m[1];
    if (LY_WORDS.has(word) || LY_ADJECTIVES.has(word)) continue;
    add(m.index, m.index + m[0].length, "A hyphen after an -ly adverb.", `${word} ${m[2]}`);
  }

  // A bracket or curly quote with no partner in its paragraph. Not a smiley, or "a)" in a list.
  const opens: { at: number; char: string }[] = [];
  const lone = (at: number, note: string, open: boolean) => {
    if (!open) return add(Math.min(at, start(at)), at + 1, note);
    found.push({ from: at, to: Math.max(at + 1, end(at + 1)), note, opens: true });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    // ":(" and ":-(" open nothing.
    if (c === "(" && /[:;=-]/.test(text[i - 1] ?? "")) continue;
    if (c === "(" || c === "“") opens.push({ at: i, char: c });
    else if (c === ")" || c === "”") {
      const partner = c === ")" ? "(" : "“";
      const last = opens.findLastIndex((o) => o.char === partner);
      if (last >= 0) opens.splice(last, 1);
      // ":)" and the "a)" or "iii)" of a list close nothing.
      else if (c === ")" && (/[:;=-]/.test(text[i - 1] ?? "") || /(?:^|[\s(])(?:[\p{L}\p{N}]{1,2}|[ivxlc]{1,5})$/u.test(text.slice(Math.max(0, i - 6), i)))) continue;
      else lone(i, c === ")" ? "No opening parenthesis." : "No opening quote.", false);
    }
  }
  for (const o of opens) lone(o.at, o.char === "(" ? "No closing parenthesis." : "No closing quote.", true);

  // A decade with an apostrophe: "the 1990's".
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])(the\s+)((?:1\d|20)\d0)['’]s(?![\p{L}\p{N}])/giu)) {
    const from = m.index + m[1].length;
    add(from, m.index + m[0].length, "An apostrophe in a plural.", `${m[2]}s`);
  }

  // The first of two overlapping mistakes wins; at the same place, the longer.
  found.sort((x, y) => x.from - y.from || y.to - x.to);
  const kept: Mistake[] = [];
  for (const f of found) if (!kept.length || f.from >= kept[kept.length - 1].to) kept.push(f);
  return kept;
}

// ---------------------------------------------------------------------------
// The page

/**
 * Where a bare address ends, as GitHub's Markdown reads it: before punctuation at its end, and
 * before a ")" it didn't open, as in "(see https://x.org)." Skipped text that isn't an address ends
 * where it ends.
 */
function addressEnd(skipped: string): number {
  if (!/^https?:\/\//.test(skipped)) return skipped.length;
  const count = (c: string, s: string) => s.split(c).length - 1;
  let end = skipped.length;
  for (;;) {
    const c = skipped[end - 1];
    const head = skipped.slice(0, end);
    if (/[.,:;!?"'*_~]/.test(c) || (c === ")" && count(")", head) > count("(", head))) end--;
    else return end;
  }
}

let seen = new Map<string, Mistake[]>();

/**
 * Mistakes on the page, in page order. `page` is the page with ghosts blanked out, and `raw` the
 * page as it is: where `page` has a space and `raw` doesn't, the text was skipped. Each block's
 * result is kept until the block or the page's dash style changes. A quote may run on into the next
 * paragraph, as in fiction, when that paragraph opens with one.
 */
export function checkPunctuation(page: string, raw: string): Mistake[] {
  const blocks = proseBlocks(page, { headings: true });
  // The page's style comes from its prose, as pageDashStyle has it.
  const style = dashStyle(blocks.map((b) => b.text).join("\n\n"));
  const kept = new Map<string, Mistake[]>();
  const out: Mistake[] = [];
  blocks.forEach((block, i) => {
    const source = raw.slice(block.from, block.from + block.text.length);
    const key = `${style}\u0001${block.text}\u0001${source}`;
    let found = seen.get(key) ?? kept.get(key);
    if (!found) {
      let text = "";
      for (let j = 0; j < block.text.length; j++) text += block.text[j] === " " && source[j] !== " " ? SKIPPED : block.text[j];
      // What follows a bare address in the same run is prose again.
      text = text.replace(/\uFFFC+/g, (run, at: number) => {
        const end = addressEnd(source.slice(at, at + run.length));
        return run.slice(0, end) + source.slice(at + end, at + run.length);
      });
      found = punctuationIn(text, style);
    }
    kept.set(key, found);
    const runsOn = /^\s*“/.test(blocks[i + 1]?.text ?? "");
    for (const f of found) {
      if (runsOn && f.note === "No closing quote.") continue;
      out.push({ ...f, from: f.from + block.from, to: f.to + block.from });
    }
  });
  seen = kept;
  return out;
}
