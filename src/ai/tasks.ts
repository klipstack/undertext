import { EditorState, TransactionSpec } from "@codemirror/state";
import { addAiAlternatives, blockAt, countWords, findAlt, syncedVariants, touchesCode } from "../editor/commands";
import { WritingIssue } from "../editor/highlights";
import { LabSpan } from "../editor/lab";
import { layersOf } from "../editor/layers";
import { checkPage, dashesIn, hyphenDashes, Kind } from "../editor/readability";
import { curlQuotes } from "../editor/smart";
import { guessesFor, misspellings } from "../editor/spelling";
import { callClaude } from "./client";

// Each Lab feature is one Claude call with a JSON answer. Claude quotes the
// text it means; we find those quotes in the document ourselves, so a wrong
// quote is dropped instead of changing the wrong words.

// ---------------------------------------------------------------------------
// Paragraphs as Claude sees them

interface DocParagraph {
  /** 1-based label sent to Claude. */
  n: number;
  /** Document position of the paragraph's first character. */
  pos: number;
  text: string;
}

/** The page's paragraphs: runs of lines between blank lines. */
function docParagraphs(state: EditorState): DocParagraph[] {
  const { doc } = state;
  const out: DocParagraph[] = [];
  let start = -1;
  let lines: string[] = [];
  const flush = () => {
    if (start >= 0) out.push({ n: out.length + 1, pos: start, text: lines.join("\n") });
    start = -1;
    lines = [];
  };
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (!line.text.trim()) {
      flush();
      continue;
    }
    if (start < 0) start = line.from;
    lines.push(line.text);
  }
  flush();
  return out;
}

const numbered = (paras: DocParagraph[]) => paras.map((p) => `[${p.n}] ${p.text}`).join("\n\n");

interface Range {
  from: number;
  to: number;
}

/** Curly quotes as straight ones, one character for one, so Claude's straight quotes match a page that curls them. */
const straight = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/** Finds a quote in its paragraph (or, if Claude misnumbered it, in any paragraph). */
function locate(paras: DocParagraph[], n: number, quote: string, used: Range[]): Range | null {
  if (!quote) return null;
  const order = [...paras.filter((p) => p.n === n), ...paras.filter((p) => p.n !== n)];
  const find = straight(quote);
  for (const p of order) {
    const text = straight(p.text);
    let i = text.indexOf(find);
    while (i >= 0) {
      const range = { from: p.pos + i, to: p.pos + i + quote.length };
      if (!used.some((u) => u.from < range.to && u.to > range.from)) return range;
      i = text.indexOf(find, i + 1);
    }
  }
  return null;
}

const isHeading = (state: EditorState, pos: number) => /^#{1,6}\s/.test(state.doc.lineAt(pos).text);

const ghostedEntirely = (state: EditorState, r: Range) =>
  layersOf(state).ghosts.some((g) => g.from <= r.from && g.to >= r.to);

const object = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (item: object) => ({ type: "array", items: item });
const str = { type: "string" };
const int = { type: "integer" };

const VOICE =
  "You help a writer edit their own draft. The draft is Markdown: #, **, *, ~~, - and > are intentional formatting. " +
  "Paragraphs are numbered like [3]. When you quote text, copy it exactly, character for character, from one paragraph.";

// ---------------------------------------------------------------------------
// Dashes: Claude adds them freely, and many readers now take a page full of them for AI writing.

const NO_DASHES =
  "Use no more dashes than the marked text has: no — or – between words, no --, and no hyphen with a space on each side.";

/** Dashes as Review counts them, and hyphens typed for one. A range, as 1990–1995, isn't a dash. */
const dashes = (text: string) => dashesIn(text).length + hyphenDashes(text);

/** Claude's texts that have no more dashes than the alternative's text on the page. */
function noNewDashes(state: EditorState, altId: string, texts: string[]): string[] {
  const r = findAlt(state, altId);
  const most = r ? dashes(state.doc.sliceString(r.from, r.to)) : 0;
  return texts.filter((t) => dashes(t) <= most);
}

// ---------------------------------------------------------------------------
// 1. Alternatives for a word or sentence

/** What Claude is asked for other ways to say the alternative `altId`: the paragraph with it marked, and the options it has. */
export function alternativesPrompt(state: EditorState, altId: string): { system: string; prompt: string } | null {
  const r = findAlt(state, altId);
  const block = r ? blockAt(state, r.from) : null;
  if (!r || !block) return null;
  const para = state.doc.sliceString(block.from, block.to);
  const a = r.from - block.from;
  const b = r.to - block.from;
  const marked = `${para.slice(0, a)}⟦${para.slice(a, b)}⟧${para.slice(b)}`;
  const existing = syncedVariants(state, r);
  return {
    system:
      "You suggest other ways to say one part of a writer's sentence. The part is marked with ⟦ ⟧. " +
      "Each suggestion must drop in place of the marked text without changing anything around it: " +
      "same grammatical role and form (number, tense, article agreement aside), fitting the meaning and tone. " +
      `Mix close synonyms with a few that shift the nuance. Don't repeat options the writer already has. ${NO_DASHES}`,
    prompt: `Paragraph:\n${marked}\n\nOptions the writer already has: ${existing.map((v) => `"${v}"`).join(", ")}\n\nSuggest 6 alternatives for the marked text.`,
  };
}

export async function suggestAlternatives(state: EditorState, altId: string): Promise<string[]> {
  const ask = alternativesPrompt(state, altId);
  if (!ask) return [];
  const answer = await callClaude<{ alternatives: string[] }>(
    {
      ...ask,
      schema: object({ alternatives: list(str) }),
      effort: "low",
      maxTokens: 8000,
    },
    () => ({ alternatives: ["option one", "option two", "option three"] }),
  );
  return answer.alternatives;
}

/** Adds Claude's other ways to say it to the alternative, leaving out those that add a dash. Null when none is left. */
export function addSuggestions(state: EditorState, altId: string, texts: string[]): TransactionSpec | null {
  return addAiAlternatives(state, altId, noNewDashes(state, altId, texts));
}

// ---------------------------------------------------------------------------
// 2. Fixes: the words a fix changes

/**
 * Shrinks "the cat sat on teh mat" → "the cat sat on the mat" to the changed
 * word ("teh" → "the"), widened to whole words so it reads as an alternative.
 */
export function narrowChange(find: string, replace: string): { start: number; original: string; fixed: string } | null {
  let start = 0;
  while (start < find.length && start < replace.length && find[start] === replace[start]) start++;
  let endF = find.length;
  let endR = replace.length;
  while (endF > start && endR > start && find[endF - 1] === replace[endR - 1]) {
    endF--;
    endR--;
  }
  const word = (c: string | undefined) => Boolean(c && /[\p{L}\p{N}'’]/u.test(c));
  while (start > 0 && word(find[start - 1])) start--;
  while (endF < find.length && word(find[endF])) {
    endF++;
    endR++;
  }
  // A pure insertion (a missing comma) needs a word to attach to.
  if (start === endF) {
    while (start > 0 && !word(find[start - 1])) start--;
    while (start > 0 && word(find[start - 1])) start--;
  }
  const original = find.slice(start, endF);
  const fixed = replace.slice(start, endR);
  return original.trim() && fixed.trim() && original !== fixed ? { start, original, fixed } : null;
}

// ---------------------------------------------------------------------------
// 3. Checks that mark text with a reason

export type CheckId = "weak" | "long" | "convoluted" | "tone" | "hedges";

export const CHECKS: { id: CheckId; label: string; title: string; ai: boolean }[] = [
  { id: "weak", label: "Weakest sentences", title: "Mark the weakest sentences", ai: true },
  { id: "long", label: "Long sentences", title: "Mark sentences that run long", ai: false },
  { id: "convoluted", label: "Convoluted sentences", title: "Mark convoluted sentences", ai: true },
  { id: "tone", label: "Off-tone words", title: "Mark words that don't fit the tone", ai: true },
  { id: "hedges", label: "Hedges and filler", title: "Mark hedges and filler", ai: true },
];

const CHECK_INSTRUCTIONS: Record<Exclude<CheckId, "long">, string> = {
  weak: "Mark the weakest sentences: ones that add little, repeat a point made elsewhere, or stay vague. Mark at most 6.",
  convoluted:
    "Mark sentences that are hard to follow on a first read: tangled structure, too many clauses, or unclear references.",
  tone:
    "First work out the tone of the whole piece. Then mark words or short phrases that don't fit it, " +
    "such as jargon or ornate words in plain writing, or slang in formal writing.",
  hedges:
    "Mark hedges and filler: words and short phrases that soften or pad without adding meaning " +
    "(for example just, really, very, sort of, I think, in order to, it's worth noting that). Mark only the hedge itself.",
};

interface MarkResult {
  paragraph: number;
  text: string;
  reason: string;
}

export async function runCheck(state: EditorState, check: CheckId): Promise<LabSpan[]> {
  if (check === "long") return longSentences(state);
  const paras = docParagraphs(state);
  if (!paras.length) return [];
  const answer = await callClaude<{ marks: MarkResult[] }>(
    {
      system:
        `${VOICE} ${CHECK_INSTRUCTIONS[check]} For each mark, quote the exact text and give a reason in under 12 words. ` +
        "Don't mark headings. Return an empty list if nothing qualifies.",
      prompt: numbered(paras),
      schema: object({ marks: list(object({ paragraph: int, text: str, reason: str })) }),
      effort: "medium",
      maxTokens: 16000,
    },
    () => ({ marks: paras.slice(1, 3).map((p) => ({ paragraph: p.n, text: p.text.split(/(?<=\.)\s/)[0], reason: "Mock reason" })) }),
  );
  const used: Range[] = [];
  const spans: LabSpan[] = [];
  for (const m of answer.marks) {
    const r = locate(paras, m.paragraph, m.text, used);
    if (!r || isHeading(state, r.from)) continue;
    used.push(r);
    spans.push({ ...r, reason: m.reason });
  }
  return spans;
}

/** No AI needed: sentences over `limit` words. */
export function longSentences(state: EditorState, limit = 30): LabSpan[] {
  const spans: LabSpan[] = [];
  for (const p of docParagraphs(state)) {
    if (/^#{1,6}\s/.test(p.text)) continue;
    for (const m of p.text.matchAll(/[^.!?\n]+(?:[.!?]+["'”’)\]]*|$)/g)) {
      const words = m[0].match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
      if (words <= limit) continue;
      const lead = m[0].length - m[0].trimStart().length;
      const from = p.pos + m.index + lead;
      spans.push({ from, to: p.pos + m.index + m[0].trimEnd().length, reason: `${words} words` });
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// 4. Trim: Claude picks text to delete, never rewrites

export const TRIMS = [
  { id: "slight", label: "Slight trim", percent: 10 },
  { id: "tighten", label: "Tighten more", percent: 20 },
  { id: "sharper", label: "Even sharper", percent: 35 },
  { id: "half", label: "Cut in half", percent: 50 },
] as const;

export type TrimId = (typeof TRIMS)[number]["id"];

export async function proposeTrim(state: EditorState, percent: number): Promise<LabSpan[]> {
  const paras = docParagraphs(state);
  const total = countWords(state).words;
  if (!paras.length || !total) return [];
  const target = Math.max(1, Math.round((total * percent) / 100));
  const answer = await callClaude<{ cuts: { paragraph: number; text: string }[] }>(
    {
      system:
        `${VOICE} Tighten the draft by choosing text to delete. Never rewrite or add words: only pick exact, ` +
        "contiguous spans to remove. After every cut in a paragraph, what remains must still read correctly, " +
        "so include a neighbouring comma or space in a cut when that keeps the punctuation clean. " +
        "Cut filler, hedges, repetition, and asides before substance. Don't cut headings.",
      prompt: `Cut about ${target} words (${percent}% of ${total}).\n\n${numbered(paras)}`,
      schema: object({ cuts: list(object({ paragraph: int, text: str })) }),
      effort: percent >= 35 ? "high" : "medium",
      maxTokens: 32000,
    },
    () => ({ cuts: mockCuts(paras) }),
  );
  const used: Range[] = [];
  const spans: LabSpan[] = [];
  for (const c of answer.cuts) {
    const r = locate(paras, c.paragraph, c.text, used);
    if (!r || isHeading(state, r.from) || ghostedEntirely(state, r)) continue;
    used.push(r);
    spans.push(r);
  }
  return spans.sort((a, b) => a.from - b.from);
}

export function wordsIn(state: EditorState, spans: LabSpan[]): number {
  return spans.reduce(
    (sum, s) => sum + (state.doc.sliceString(s.from, s.to).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0),
    0,
  );
}

// ---------------------------------------------------------------------------
// 5. Writing issues: grammar, spelling, and wrong words, marked pink in Review, each with a fix

export interface WritingAnswer {
  paragraph: number;
  find: string;
  replace: string;
  reason: string;
}

/**
 * Claude's answer quotes the page. The page may change while Claude works, so place the answer
 * with writingIssuesFrom on the page as it is when the answer comes.
 */
/** What Claude is asked for writing issues: the page's paragraphs, numbered. Null for an empty page. */
export function writingIssuesPrompt(state: EditorState): { system: string; prompt: string } | null {
  const paras = docParagraphs(state);
  if (!paras.length) return null;
  return {
    system:
      `${VOICE} Find writing issues: grammar, spelling, punctuation, a wrong or missing word, a broken idiom, ` +
      "a sentence fragment, or words that don't agree. In punctuation, look hardest for what simple rules can't " +
      "find: a comma splice, “its” for “it’s” or the other way round, a comma between a subject and its verb, and " +
      "an aside that opens with a dash and closes with a comma. Leave out words that aren't words at all: the spell " +
      "checker marks those. A fix adds no dash: give a comma splice a period or a semicolon, and close an aside the " +
      "way it opens, or make its dash a comma. Don't flag style choices that are correct, and don't " +
      "rewrite for taste. Don't flag headings. For each issue, quote a short snippet (a few words, unique within " +
      "its paragraph) as `find`, give the same snippet corrected as `replace`, and a reason in under 10 words. " +
      "Mark at most 30. Return an empty list if there are none.",
    prompt: numbered(paras),
  };
}

export async function findWritingIssues(state: EditorState): Promise<WritingAnswer[]> {
  const ask = writingIssuesPrompt(state);
  if (!ask) return [];
  const paras = docParagraphs(state);
  const answer = await callClaude<{ issues: WritingAnswer[] }>(
    {
      ...ask,
      schema: object({ issues: list(object({ paragraph: int, find: str, replace: str, reason: str })) }),
      effort: "medium",
      maxTokens: 16000,
    },
    () => ({ issues: mockWritingIssues(paras) }),
  );
  return answer.issues;
}

/**
 * Finds each quote on the page and marks the words that change, with the fix for them. A change
 * with no word to swap, such as a deletion, marks the whole quote. Headings, ghosts, and code are
 * skipped, and so is a fix of exactly a misspelled word that the Mac suggests too, as its spelling
 * mark offers it. Load the guesses for such words first (loadGuesses).
 */
export function writingIssuesFrom(state: EditorState, answers: WritingAnswer[]): WritingIssue[] {
  const paras = docParagraphs(state);
  const used: Range[] = [];
  const issues: WritingIssue[] = [];
  for (const a of answers) {
    if (a.find === a.replace) continue;
    const found = locate(paras, a.paragraph, a.find, used);
    if (!found || isHeading(state, found.from) || ghostedEntirely(state, found) || touchesCode(state, found.from, found.to)) continue;
    // A fix adds no dash, as alternatives and rewrites don't. Count the whole lines, so a dash at the
    // quote's edge counts as it will on the page.
    const lines = { from: state.doc.lineAt(found.from).from, to: state.doc.lineAt(found.to).to };
    const now = state.doc.sliceString(lines.from, lines.to);
    const then = now.slice(0, found.from - lines.from) + a.replace + now.slice(found.to - lines.from);
    if (dashes(then) > dashes(now)) continue;
    used.push(found);
    const change = narrowChange(a.find, a.replace);
    const from = found.from + (change?.start ?? 0);
    const to = change ? from + change.original.length : found.to;
    // On a page that curls its quotes, so does the fix.
    const raw = change ? change.fixed : a.replace;
    const fix = /[‘’“”]/.test(state.doc.sliceString(found.from, found.to)) ? curlQuotes(raw) : raw;
    // The spelling mark offers the same fix. Until the Mac's guesses come, Claude's may be the only one.
    if (misspellings(state).some((w) => w.from === from && w.to === to && guessesFor(state, w.word)?.includes(fix))) continue;
    issues.push({ from, to, kind: "grammar", note: a.reason, fix });
  }
  return issues.sort((x, y) => x.from - y.from);
}

// ---------------------------------------------------------------------------
// 6. Rewrites of a marked sentence, from Review's popover

/** What a rewrite must fix, by the kind of mark it is for. */
const REWRITE_GOALS: Partial<Record<Kind, string>> = {
  passive:
    "Put it in the active voice: name who or what acts. If the paragraph doesn't say who acts, choose a " +
    "fitting subject, or recast the sentence so its subject acts, as in “The door swung shut”.",
  hard: "Make it easier to read: fewer words, plainer words, or two sentences.",
  veryHard: "Make it easier to read: fewer words, plainer words, or two sentences.",
  hidden: "Use a plain verb in place of the noun that hides the action, as “decided” for “made a decision”.",
  cliche: "Say it in plain words of its own, in place of the cliché.",
  dash: "Use a comma, a colon, parentheses, or a period in place of each dash, and no dash at all.",
};

/** How the prompt names each kind of mark. */
const MARK_NAMES: Partial<Record<Kind, string>> = { passive: "passive voice", hidden: "a hidden action", cliche: "a cliché" };

/**
 * What Claude is asked for a rewrite of the alternative `altId`: the paragraph with it marked, the
 * goal, the words the checks flagged when they are only part of it, and the rewrites it has.
 */
export function rewritePrompt(state: EditorState, altId: string, kind: Kind, phrase: string): { system: string; prompt: string } | null {
  const r = findAlt(state, altId);
  const block = r ? blockAt(state, r.from) : null;
  if (!r || !block) return null;
  const para = state.doc.sliceString(block.from, block.to);
  const a = r.from - block.from;
  const b = r.to - block.from;
  const marked = `${para.slice(0, a)}⟦${para.slice(a, b)}⟧${para.slice(b)}`;
  const flagged = MARK_NAMES[kind] && phrase !== para.slice(a, b) ? ` The checks flagged “${phrase}” as ${MARK_NAMES[kind]}.` : "";
  const others = syncedVariants(state, r).filter((v) => v !== para.slice(a, b));
  // A dash too many has its own goal: no dash at all.
  const dashRule = kind === "dash" ? "" : ` ${NO_DASHES} Use a comma, a colon, parentheses, or a period instead.`;
  return {
    system:
      `${VOICE} Rewrite the part of the writer's paragraph marked with ⟦ ⟧. ${REWRITE_GOALS[kind] ?? ""}${flagged} ` +
      "Keep its meaning, facts, and tone, and add nothing new. Each rewrite replaces the marked text on its own, " +
      `on one line. Make them differ from each other, and from the rewrites the writer has already.${dashRule}`,
    prompt:
      `Paragraph:\n${marked}\n\nRewrites the writer has already: ${others.length ? others.map((v) => `“${v}”`).join(", ") : "none"}.\n\n` +
      "Suggest 6 rewrites of the marked text.",
  };
}

/** Claude's rewrites of the marked text, aimed at what the mark is about. */
export async function suggestRewrites(state: EditorState, altId: string, kind: Kind, phrase: string): Promise<string[]> {
  const ask = rewritePrompt(state, altId, kind, phrase);
  if (!ask) return [];
  const answer = await callClaude<{ rewrites: string[] }>(
    {
      ...ask,
      schema: object({ rewrites: list(str) }),
      effort: "low",
      maxTokens: 8000,
    },
    () => ({ rewrites: ["Someone closed it.", "It was closed.", "It swung shut."] }),
  );
  return answer.rewrites;
}

/** Whether a text still has the issue a mark was about. Hard and very hard count as one. A rewrite of a dash too many keeps none. */
function stillHas(kind: Kind, text: string): boolean {
  if (kind === "dash") return dashes(text) > 0;
  const sentence = (k: Kind) => k === "hard" || k === "veryHard";
  return checkPage(text).issues.some((i) => i.kind === kind || (sentence(kind) && sentence(i.kind)));
}

/**
 * Adds Claude's rewrites to the alternative, keeping only those the live checks no longer mark the
 * same way, and that add no dash: a rewrite of passive voice with passive voice left is dropped.
 * Null when none is left.
 */
export function addRewrites(state: EditorState, altId: string, kind: Kind, texts: string[]): TransactionSpec | null {
  return addAiAlternatives(state, altId, noNewDashes(state, altId, texts).filter((t) => !stillHas(kind, t)));
}

// ---------------------------------------------------------------------------
// Development mocks (plain browser only)

/** A doubled word, and "And" at the start of a sentence. */
function mockWritingIssues(paras: DocParagraph[]): WritingAnswer[] {
  const issues: WritingAnswer[] = [];
  for (const p of paras) {
    for (const m of p.text.matchAll(/\b(\w+) \1\b/g)) {
      issues.push({ paragraph: p.n, find: m[0], replace: m[1], reason: "The same word twice." });
    }
    for (const m of p.text.matchAll(/(?:^|[.!?] )And (\w+)/g)) {
      const find = m[0].replace(/^[.!?] /, "");
      const word = m[1][0].toUpperCase() + m[1].slice(1);
      issues.push({ paragraph: p.n, find, replace: word, reason: "A sentence that starts with And." });
    }
  }
  return issues;
}

function mockCuts(paras: DocParagraph[]): { paragraph: number; text: string }[] {
  const cuts: { paragraph: number; text: string }[] = [];
  for (const p of paras) {
    for (const m of p.text.matchAll(/ (?:just|really|very|too|then)\b/g)) cuts.push({ paragraph: p.n, text: m[0] });
  }
  return cuts;
}
