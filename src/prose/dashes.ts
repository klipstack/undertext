// Dashes: where they are, the style a page writes them in, and a dash too many in a paragraph.

import { Issue } from "./issues";
import { proseBlocks } from "./markdown";
import { sentences } from "./sentences";

/** How the page writes its dashes: "word—word", "word — word", or "word – word". */
export type DashStyle = "closed" | "spaced" | "spacedEn";

/** A dash in each style. */
export const DASHES: Record<DashStyle, string> = { closed: "—", spaced: " — ", spacedEn: " – " };

/** Days and months, as in "Monday - Friday": a range, not a dash. */
const DATES =
  /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\.?$/i;
/** Words that end a range of numbers, as in "2019 - present". */
const RANGE_ENDS = /^(?:present|now|today|noon|midnight|date)$/i;
/** A word without the brackets, quotes, and punctuation around it. */
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** The word that ends at `at`, or starts there: the characters up to a space, at most 40 of them. */
function wordBefore(text: string, at: number): string {
  let a = at;
  while (a > 0 && at - a < 40 && !/\s/.test(text[a - 1])) a--;
  return text.slice(a, at);
}
function wordAfter(text: string, at: number): string {
  let b = at;
  while (b < text.length && b - at < 40 && !/\s/.test(text[b])) b++;
  return text.slice(at, b);
}

/** Whether two words around a hyphen or dash make a range: numbers, hours, money, days, or months. */
export function isRange(left: string, right: string): boolean {
  const [l, r] = [bare(left), bare(right)];
  return (/\d/.test(l) && (/\d/.test(r) || RANGE_ENDS.test(r))) || (RANGE_ENDS.test(l) && /\d/.test(r)) || (DATES.test(l) && DATES.test(r));
}

/**
 * Where the dashes are in a text: "—" or "―", and "–" with a space on each side. Not a range
 * ("1990 – 1995", "9am – 5pm"), a dash that starts a line, as a bullet does, one after a sentence's
 * end, as an attribution, or one of a run, as in "Mrs. C——".
 */
export function dashesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[—―]|(?<=[ \t])–(?=[ \t])/g)) {
    const i = m.index;
    if (/[—―]/.test(text[i - 1] ?? "") || /[—―]/.test(text[i + 1] ?? "")) continue;
    // Only spaces and quote markers before it on its line, or a sentence's end and a space.
    let j = i;
    while (j > 0 && /[ \t>]/.test(text[j - 1])) j--;
    if (j === 0 || text[j - 1] === "\n") continue;
    if (j < i && /[ \t]/.test(text[i - 1]) && /[.!?]["”’)]*$/.test(text.slice(Math.max(0, j - 4), j))) continue;
    if (text[i] === "–" && isRange(wordBefore(text, i - 1), wordAfter(text, i + 2))) continue;
    out.push(i);
  }
  return out;
}

/** Hyphens typed for a dash, "--" and " - " between words, as Claude may write them. Not a range or an arrow. */
export function hyphenDashes(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/(?<![-<])--(?![->])|(?<=\S) - (?=\S)/g)) {
    let a = m.index;
    while (a > 0 && text[a - 1] === " ") a--;
    let b = m.index + m[0].length;
    while (b < text.length && text[b] === " ") b++;
    if (!isRange(wordBefore(text, a), wordAfter(text, b))) n++;
  }
  return n;
}

const nonSpace = (c: string | undefined) => c !== undefined && !/[\s\uFFFC]/.test(c);
const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * The style of the dash at `i`: closed between two words, or spaced with one space on each side.
 * Null for any other, as one beside a quote, or beside a link's address, which the prose checks
 * read as spaces.
 */
function styleAt(text: string, i: number): DashStyle | null {
  const spaced = text[i - 1] === " " && text[i + 1] === " " && nonSpace(text[i - 2]) && nonSpace(text[i + 2]);
  if (text[i] === "―") return null;
  if (text[i] === "–") return spaced ? "spacedEn" : null;
  if (spaced) return "spaced";
  return wordChar(text[i - 1]) && wordChar(text[i + 1]) ? "closed" : null;
}

/**
 * Whether the dash at `i` belongs to speech that breaks off or stammers: "But—”", "“—and", "I—I",
 * "no—no", or a dash that ends the text. A straight quote opens after a space and closes before one.
 */
function speechAt(text: string, i: number, end: number): boolean {
  const [before, after] = [text[i - 1] ?? "", text[i + 1] ?? ""];
  if (/[“‘(]/.test(before) || /[”’)]/.test(after) || i + 1 >= end) return true;
  if (/["']/.test(before) && !/\S/.test(text[i - 2] ?? "")) return true;
  if (/["']/.test(after) && /^(?:[\s.,;:!?]|$)/.test(text.slice(i + 2, i + 3))) return true;
  // A stammer repeats a short word: "I—I", "no—no".
  const left = /\p{L}{1,3}$/u.exec(text.slice(Math.max(0, i - 4), i))?.[0].toLowerCase();
  const right = text.slice(i + 1, i + 5).toLowerCase();
  return Boolean(left && !/\p{L}/u.test(text[i - 1 - left.length] ?? "") && right.startsWith(left));
}

/**
 * The style the page uses most. A page with no dashes, or a tie with closed dashes, uses closed em
 * dashes; a tie between spaced em and en dashes, spaced em dashes. Skipped text, written as U+FFFC,
 * isn't a word beside a dash.
 */
export function dashStyle(page: string): DashStyle {
  const count = { closed: 0, spaced: 0, spacedEn: 0 };
  const end = page.trimEnd().length;
  for (const i of dashesIn(page)) {
    const style = speechAt(page, i, end) ? null : styleAt(page, i);
    if (style) count[style]++;
  }
  if (count.spaced > count.closed && count.spaced >= count.spacedEn) return "spaced";
  if (count.spacedEn > count.closed && count.spacedEn > count.spaced) return "spacedEn";
  return "closed";
}

/** The dash style of a page's prose: code, link addresses, and ranges don't count. */
export const pageDashStyle = (page: string) => dashStyle(proseBlocks(page, { headings: true }).map((b) => b.text).join("\n\n"));

const STYLE_NOTES: Record<DashStyle, string> = {
  closed: "This page writes its dashes closed up: “word—word”.",
  spaced: "This page spaces its dashes: “word — word”.",
  spacedEn: "This page uses spaced en dashes: “word – word”.",
};

/**
 * Dashes in one block. A paragraph may use them once: a pair around an aside, or one dash before a
 * break. Each later use is marked, a pair from dash to dash, a single dash to its sentence's end or
 * its line's. Speech that breaks off ("But—”") or stammers ("I—I") isn't a use. A dash in another
 * style than the page's is marked too, with the page's style as its fix, unless it's a use too many.
 */
export function dashIssues(text: string, style: DashStyle): Issue[] {
  const issues: Issue[] = [];
  const all = dashesIn(text);
  const end = text.trimEnd().length;
  let uses = 0;
  for (const s of sentences(text)) {
    const at = all.filter((i) => s.from <= i && i < s.to && !speechAt(text, i, end));
    for (let k = 0; k < at.length; k += 2) {
      if (++uses === 1) continue;
      const pair = k + 1 < at.length;
      const lineEnd = text.indexOf("\n", at[k]);
      const to = pair ? at[k + 1] + 1 : lineEnd >= 0 ? Math.min(s.to, lineEnd) : s.to;
      issues.push({ from: at[k], to, kind: "dash", note: pair ? "Another pair of dashes in this paragraph." : "Another dash in this paragraph." });
    }
  }
  // Dashes whose words touch, as in "plan — bold — failed", make one mark with one fix.
  const groups: { from: number; to: number; dashes: [number, number][] }[] = [];
  for (const i of all) {
    const mine = styleAt(text, i);
    if (!mine || mine === style || speechAt(text, i, end) || issues.some((d) => d.from <= i && i < d.to)) continue;
    const [a, b] = mine === "closed" ? [i, i + 1] : [i - 1, i + 2];
    let from = a;
    while (from > 0 && !/\s/.test(text[from - 1])) from--;
    let to = b;
    while (to < text.length && !/\s/.test(text[to])) to++;
    const last = groups.at(-1);
    if (last && from < last.to) {
      last.to = Math.max(last.to, to);
      last.dashes.push([a, b]);
    } else groups.push({ from, to, dashes: [[a, b]] });
  }
  for (const g of groups) {
    let fix = "";
    let at = g.from;
    for (const [a, b] of g.dashes) {
      fix += text.slice(at, a) + DASHES[style];
      at = b;
    }
    issues.push({ from: g.from, to: g.to, kind: "dashStyle", note: STYLE_NOTES[style], fix: fix + text.slice(at, g.to) });
  }
  return issues;
}
