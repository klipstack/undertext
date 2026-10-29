import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { ChangeSpec, EditorSelection, EditorState, StateCommand, TransactionSpec } from "@codemirror/state";
import { startsWithVowelSound } from "../prose";
import { Alt, Layers, newId, parseInline, serializeBlock, Span, Version } from "./format";
import { blockLines, layersOf, mapLayers, setLayers } from "./layers";

// Commands return a transaction spec, or null when they don't apply.
// Positions are plain offsets into the page text.

/** Swapping a variant in is its own undo step, never merged with typing. */
const ownStep = isolateHistory.of("full");

const byFrom = <T extends Span>(a: T, b: T) => a.from - b.from;

// ---------------------------------------------------------------------------
// Finding things

export function findAlt(state: EditorState, id: string): Alt | null {
  return layersOf(state).alts.find((a) => a.id === id) ?? null;
}

/** The alternative at `pos`, edges included. */
export function altAt(state: EditorState, pos: number): Alt | null {
  return layersOf(state).alts.find((a) => a.from <= pos && pos <= a.to) ?? null;
}

export function altInSelection(state: EditorState): Alt | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return altAt(state, from);
  return layersOf(state).alts.find((a) => a.from < to && a.to > from) ?? null;
}

/** The variants with the active one read from the page. */
export function syncedVariants(state: EditorState, alt: Alt): string[] {
  const variants = [...alt.variants];
  variants[alt.active] = state.doc.sliceString(alt.from, alt.to);
  return variants;
}

export function wordRangeAt(state: EditorState, pos: number): Span | null {
  const line = state.doc.lineAt(pos);
  const isWord = (c: string | undefined) => Boolean(c && /[\p{L}\p{N}'’-]/u.test(c));
  let a = pos - line.from;
  let b = a;
  while (a > 0 && isWord(line.text[a - 1])) a--;
  while (b < line.text.length && isWord(line.text[b])) b++;
  return a === b ? null : { from: line.from + a, to: line.from + b };
}

/**
 * What Look Up shows for a right click at `pos`: the selection when the click is in it, or the
 * word there. Null when that has no letters or runs over more than one line.
 */
export function lookUpRange(state: EditorState, pos: number): Span | null {
  const sel = state.selection.main;
  const span = !sel.empty && sel.from <= pos && pos <= sel.to ? { from: sel.from, to: sel.to } : wordRangeAt(state, pos);
  if (!span) return null;
  const text = state.doc.sliceString(span.from, span.to);
  // The word's own edges may hold a closing quote or a dash; a selection's may hold spaces.
  const start = text.search(/[\p{L}\p{N}]/u);
  const end = text.length - (text.match(/[^\p{L}\p{N}]*$/u)?.[0].length ?? 0);
  const inner = text.slice(start, end);
  if (start < 0 || inner.includes("\n") || !/\p{L}/u.test(inner)) return null;
  return { from: span.from + start, to: span.from + end };
}

/** The paragraph at `pos`: from its first line to the end of its last. Null on a blank line. */
export function blockAt(state: EditorState, pos = state.selection.main.head): Span | null {
  const { doc } = state;
  let line = doc.lineAt(pos);
  if (!line.text.trim()) return null;
  while (line.number > 1 && doc.line(line.number - 1).text.trim()) line = doc.line(line.number - 1);
  const { to } = blockLines(doc, line.from);
  return { from: line.from, to };
}

export function versionAt(state: EditorState, pos = state.selection.main.head): Version | null {
  const block = blockAt(state, pos);
  return block ? (layersOf(state).versions.find((v) => v.at === block.from) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Word and sentence alternatives

function withAlt(l: Layers, alt: Alt | null, id: string): Layers {
  const alts = l.alts.filter((a) => a.id !== id);
  if (alt) alts.push(alt);
  return { ...l, alts: alts.sort(byFrom) };
}

/** Wraps a range in a new alternative. The current text becomes the original. */
export function createAlt(state: EditorState, from: number, to: number): { spec: TransactionSpec; id: string } | null {
  const raw = state.doc.sliceString(from, to);
  if (raw.includes("\n")) return null;
  from += raw.length - raw.trimStart().length;
  to -= raw.length - raw.trimEnd().length;
  if (from >= to) return null;
  const existing = layersOf(state).alts.find((a) => a.from < to && a.to > from);
  if (existing) return { spec: {}, id: existing.id };
  const id = newId();
  const alt: Alt = { from, to, id, variants: [state.doc.sliceString(from, to)], active: 0, ai: [] };
  return { spec: { effects: setLayers.of(withAlt(layersOf(state), alt, id)) }, id };
}

function replaceAlt(state: EditorState, alt: Alt, variants: string[], active: number, ai = alt.ai): TransactionSpec {
  const text = variants[active];
  const article = articleFix(state, alt.from, text);
  const changes = state.changes([...(article ? [article] : []), { from: alt.from, to: alt.to, insert: text }]);
  const from = changes.mapPos(alt.from, 1);
  const next: Alt = { ...alt, from, to: from + text.length, variants, active, ai: ai.filter((t) => variants.includes(t)) };
  const sel = state.selection.main;
  const inside = sel.from >= alt.from && sel.to <= alt.to;
  return {
    changes,
    effects: setLayers.of(withAlt(mapLayers(layersOf(state), changes), next, alt.id)),
    selection: inside ? EditorSelection.cursor(next.to) : undefined,
    annotations: ownStep,
  };
}

export function setAltActive(state: EditorState, id: string, index: number): TransactionSpec | null {
  const alt = findAlt(state, id);
  if (!alt) return null;
  const variants = syncedVariants(state, alt);
  if (index < 0 || index >= variants.length) return null;
  return replaceAlt(state, alt, variants, index);
}

export function cycleAlt(state: EditorState, id: string, dir: 1 | -1): TransactionSpec | null {
  const alt = findAlt(state, id);
  const n = alt?.variants.length ?? 0;
  if (!alt || n < 2) return null;
  return setAltActive(state, id, (alt.active + dir + n) % n);
}

export function addAltVariant(state: EditorState, id: string, text: string): TransactionSpec | null {
  const alt = findAlt(state, id);
  const value = text.trim();
  if (!alt || !value || value.includes("\n")) return null;
  const variants = syncedVariants(state, alt);
  const existing = variants.indexOf(value);
  if (existing >= 0) return replaceAlt(state, alt, variants, existing);
  variants.push(value);
  return replaceAlt(state, alt, variants, variants.length - 1);
}

/** Adds AI suggestions without switching away from the current text. */
export function addAiAlternatives(state: EditorState, id: string, texts: string[]): TransactionSpec | null {
  const alt = findAlt(state, id);
  if (!alt) return null;
  const variants = syncedVariants(state, alt);
  const seen = new Set(variants.map((v) => v.toLowerCase()));
  const added: string[] = [];
  // Text that would save a different page, or show a different one: a line break, a backtick or
  // HTML, which can hide code, half of some bold or italics, or block markup where the alternative
  // starts a line.
  const line = state.doc.lineAt(alt.from);
  const startsLine = leadLength(line.text) >= alt.from - line.from;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text || /[\r\n`<]/.test(text) || unbalancedMarkup(text) || (startsLine && BLOCK_START.test(text))) continue;
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    variants.push(text);
    added.push(text);
  }
  if (!added.length) return null;
  return replaceAlt(state, alt, variants, alt.active, [...alt.ai, ...added]);
}

export function removeAltVariant(state: EditorState, id: string, index: number): TransactionSpec | null {
  const alt = findAlt(state, id);
  if (!alt) return null;
  const variants = syncedVariants(state, alt);
  if (variants.length < 2) return dropAlt(state, id);
  variants.splice(index, 1);
  const next = index === alt.active ? Math.max(0, index - 1) : index < alt.active ? alt.active - 1 : alt.active;
  return replaceAlt(state, alt, variants, next);
}

/** Keeps the current text of an alternative and drops the others. */
export function dropAlt(state: EditorState, id: string): TransactionSpec | null {
  return findAlt(state, id) ? { effects: setLayers.of(withAlt(layersOf(state), null, id)) } : null;
}

/** Removes alternatives that have only one variant left. */
export function cleanupSingleAlts(state: EditorState): TransactionSpec | null {
  const l = layersOf(state);
  const alts = l.alts.filter((a) => a.variants.length > 1);
  return alts.length === l.alts.length ? null : { effects: setLayers.of({ ...l, alts }) };
}

// ---------------------------------------------------------------------------
// Keyboard: cycle at the caret, jump between items with versions

/** Cycles the word or sentence at the caret, or else its paragraph. */
export function cycleAtCaret(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const alt = altInSelection(state);
  if (alt && alt.variants.length > 1) return cycleAlt(state, alt.id, dir);
  return cycleVersionAtCaret(state, dir);
}

export function cycleVersionAtCaret(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const v = versionAt(state);
  return v ? cycleVersion(state, v.at, dir) : null;
}

export interface VersionedItem extends Span {
  kind: "alt" | "para";
}

/** Everything that has more than one version, in page order. A paragraph comes before its words. */
export function versionedItems(state: EditorState): VersionedItem[] {
  const l = layersOf(state);
  const items: VersionedItem[] = [
    ...l.versions.map((v) => ({ ...blockLines(state.doc, v.at), kind: "para" as const })),
    ...l.alts.filter((a) => a.variants.length > 1).map((a) => ({ from: a.from, to: a.to, kind: "alt" as const })),
  ];
  return items
    .map(({ from, to, kind }) => ({ from, to, kind }))
    .sort((a, b) => a.from - b.from || (a.kind === "para" ? -1 : 1));
}

/**
 * Moves the caret to the next or previous item with versions, wrapping around.
 * `lastIndex` breaks ties when a paragraph and its first word start at the same spot.
 */
export function jumpToItem(
  state: EditorState,
  dir: 1 | -1,
  lastIndex: number | null,
): { spec: TransactionSpec; index: number } | null {
  const items = versionedItems(state);
  if (!items.length) return null;
  const head = state.selection.main.head;
  let index: number;
  if (lastIndex !== null && items[lastIndex]?.from === head) index = lastIndex + dir;
  else if (dir > 0) index = items.findIndex((i) => i.from > head);
  else index = items.findLastIndex((i) => i.from < head);
  const n = items.length;
  index = index < 0 ? (dir > 0 ? 0 : n - 1) : (index + n) % n;
  return { spec: { selection: EditorSelection.cursor(items[index].from), scrollIntoView: true }, index };
}

// ---------------------------------------------------------------------------
// a / an

/** The change that fixes "a"/"an" right before `from` for `word`, if one is needed. */
export function articleFix(state: EditorState, from: number, word: string): { from: number; to: number; insert: string } | null {
  const line = state.doc.lineAt(from);
  const winStart = Math.max(line.from, from - 12);
  const before = state.doc.sliceString(winStart, from);
  const re = winStart === line.from ? /(?:^|[^\p{L}\p{N}])(an|a)(\s+)$/iu : /[^\p{L}\p{N}](an|a)(\s+)$/iu;
  const m = re.exec(before);
  if (!m) return null;
  const article = m[1];
  const wantAn = startsWithVowelSound(word);
  if (wantAn === (article.toLowerCase() === "an")) return null;
  let replacement = wantAn ? "an" : "a";
  if (article === article.toUpperCase() && article.length > 1) replacement = replacement.toUpperCase();
  else if (article[0] === article[0].toUpperCase()) replacement = replacement[0].toUpperCase() + replacement.slice(1);
  const artFrom = from - m[2].length - article.length;
  return { from: artFrom, to: artFrom + article.length, insert: replacement };
}

// ---------------------------------------------------------------------------
// Paragraph versions

export function findVersion(state: EditorState, at: number): Version | null {
  return layersOf(state).versions.find((v) => v.at === at) ?? null;
}

/** The inline Markdown of `from..to`, with the layers inside it. */
export function rangeMarkdown(state: EditorState, from: number, to: number): string {
  const l = layersOf(state);
  const alts = l.alts.filter((a) => a.from >= from && a.to <= to).map((a) => ({ ...a, from: a.from - from, to: a.to - from }));
  const ghosts = l.ghosts
    .filter((g) => g.from < to && g.to > from)
    .map((g) => ({ from: Math.max(g.from, from) - from, to: Math.min(g.to, to) - from }));
  const text = state.doc.sliceString(from, to);
  return serializeBlock({ text, alts, ghosts }, 0, text.length);
}

function currentBlockMarkdown(state: EditorState, at: number): string {
  return rangeMarkdown(state, at, blockLines(state.doc, at).to);
}

function syncedVersionVariants(state: EditorState, at: number): { variants: string[]; active: number } {
  const v = findVersion(state, at);
  const current = currentBlockMarkdown(state, at);
  if (!v) return { variants: [current], active: 0 };
  const variants = [...v.variants];
  variants[v.active] = current;
  return { variants, active: v.active };
}

/** Puts version `active` of the paragraph at `at` on the page. */
function replaceBlock(state: EditorState, at: number, variants: string[], active: number): TransactionSpec {
  const { to } = blockLines(state.doc, at);
  const inline = parseInline(variants[active]);
  const changes = state.changes({ from: at, to, insert: inline.text });
  const mapped = mapLayers(layersOf(state), changes);
  const end = at + inline.text.length;
  const outside = <T extends Span>(r: T) => r.to <= at || r.from >= end;
  const shift = <T extends Span>(r: T): T => ({ ...r, from: r.from + at, to: r.to + at });
  const keep = variants.length > 1;
  const old = findVersion(state, at);
  const versions = mapped.versions.filter((v) => v.at !== at);
  if (keep) versions.push({ at, vid: old?.vid ?? newId(), variants, active });
  const sel = state.selection.main;
  return {
    changes,
    effects: setLayers.of({
      alts: [...mapped.alts.filter(outside), ...inline.alts.map(shift)].sort(byFrom),
      ghosts: [...mapped.ghosts.filter(outside), ...inline.ghosts.map(shift)].sort(byFrom),
      versions: versions.sort((a, b) => a.at - b.at),
    }),
    selection: sel.from >= at && sel.from <= to ? EditorSelection.cursor(end) : undefined,
    annotations: ownStep,
  };
}

export function setVersionActive(state: EditorState, at: number, index: number): TransactionSpec | null {
  const { variants } = syncedVersionVariants(state, at);
  if (index < 0 || index >= variants.length) return null;
  return replaceBlock(state, at, variants, index);
}

export function cycleVersion(state: EditorState, at: number, dir: 1 | -1): TransactionSpec | null {
  const v = findVersion(state, at);
  const n = v?.variants.length ?? 0;
  if (!v || n < 2) return null;
  return setVersionActive(state, at, (v.active + dir + n) % n);
}

/** Copies the current paragraph into a new version and makes it active. */
export function forkVersion(state: EditorState, at: number): TransactionSpec | null {
  const { variants, active } = syncedVersionVariants(state, at);
  variants.push(variants[active]);
  const old = findVersion(state, at);
  const l = layersOf(state);
  const version: Version = { at, vid: old?.vid ?? newId(), variants, active: variants.length - 1 };
  return { effects: setLayers.of({ ...l, versions: [...l.versions.filter((v) => v.at !== at), version].sort((a, b) => a.at - b.at) }) };
}

export function removeVersionVariant(state: EditorState, at: number, index: number): TransactionSpec | null {
  if (!findVersion(state, at)) return null;
  const { variants, active } = syncedVersionVariants(state, at);
  variants.splice(index, 1);
  const next = index === active ? Math.max(0, index - 1) : index < active ? active - 1 : active;
  return replaceBlock(state, at, variants, next);
}

/** Keeps the current version of a paragraph and drops the others. */
export function settleVersion(state: EditorState, at: number): TransactionSpec | null {
  const l = layersOf(state);
  if (!findVersion(state, at)) return null;
  return { effects: setLayers.of({ ...l, versions: l.versions.filter((v) => v.at !== at) }) };
}

/** Keeps every current choice in the page. Ghosts stay as they are. */
export function settleAll(state: EditorState): TransactionSpec | null {
  const l = layersOf(state);
  if (!l.alts.length && !l.versions.length) return null;
  return { effects: setLayers.of({ ...l, alts: [], versions: [] }) };
}

// ---------------------------------------------------------------------------
// Ghosts

function subtract(spans: Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (s.to <= from || s.from >= to) out.push(s);
    else {
      if (s.from < from) out.push({ from: s.from, to: from });
      if (s.to > to) out.push({ from: to, to: s.to });
    }
  }
  return out;
}

export function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort(byFrom)) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

const CODE = ["InlineCode", "FencedCode", "CodeBlock"];

/** Whether `from`–`to` touches code. An alternative or a ghost there would be saved as literal text. */
export function touchesCode(state: EditorState, from: number, to: number): boolean {
  let code = false;
  (ensureSyntaxTree(state, to, 200) ?? syntaxTree(state)).iterate({
    from,
    to,
    enter: (n) => {
      if (CODE.includes(n.name)) code = true;
      return !code;
    },
  });
  return code;
}

/** What may come before a line's first word: indent, quote markers, list markers, and a task box. */
const LINE_LEAD = /^(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t])))*[ \t]*/;
/** How many characters of `text` are indent, quote markers, list markers, and a task box. */
export const leadLength = (text: string) => LINE_LEAD.exec(text)![0].length;
/** Text that starts a block of its own at the start of a line: a heading, quote, list item, rule, fence, table, or HTML. */
export const BLOCK_START = /^(?:#{1,6}(?:\s|$)|>|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|[-*_](?:\s*[-*_]){2,}\s*$|=+\s*$|`{3}|~{3}|\||<[a-zA-Z/!?])/;

/** Whether text opens or closes bold, italics, or strikethrough without the other end. */
export function unbalancedMarkup(text: string): boolean {
  const strong = text.split("**").length - 1;
  const em = (text.replace(/\*\*/g, "").match(/\*/g) ?? []).length;
  const under = (text.match(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu) ?? []).length;
  const strike = text.split("~~").length - 1;
  return [strong, em, under, strike].some((n) => n % 2 === 1);
}

/** Whether a ghost on `from`–`to` would cover only part of an alternative. A save loses such a ghost. */
export const cutsAlternative = (state: EditorState, from: number, to: number) =>
  layersOf(state).alts.some((a) => a.from < to && a.to > from && (a.from < from || a.to > to));

/**
 * Why ⌘/ won't ghost or revive the selection, or null when it will: either way, no ghost may be
 * left on part of an alternative.
 */
export function ghostBlocked(state: EditorState): string | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  const ghosts = layersOf(state).ghosts;
  if (ghosts.some((g) => g.from < to && g.to > from)) {
    const left = subtract(ghosts, from, to);
    return left.some((g) => cutsAlternative(state, g.from, g.to))
      ? "A ghost on part of an alternative isn't saved. Revive all of it, or none."
      : null;
  }
  if (touchesCode(state, from, to)) return "Code can't be ghosted: a save would write the ghost into the code.";
  return cutsAlternative(state, from, to) ? "A ghost on part of an alternative isn't saved. Ghost all of it, or none." : null;
}

export function ghostAt(state: EditorState, pos: number): Span | null {
  return layersOf(state).ghosts.find((g) => g.from <= pos && pos <= g.to) ?? null;
}

/** Ghosts the selection, or revives it if any of it is ghosted. With no selection, revives the ghost at the caret. */
export const toggleGhost: StateCommand = ({ state, dispatch }) => {
  const { from, to, empty } = state.selection.main;
  const l = layersOf(state);
  if (ghostBlocked(state)) return false;
  let ghosts: Span[];
  if (empty) {
    const g = ghostAt(state, from);
    if (!g) return false;
    ghosts = l.ghosts.filter((x) => x !== g);
  } else if (l.ghosts.some((g) => g.from < to && g.to > from)) {
    ghosts = subtract(l.ghosts, from, to);
  } else {
    ghosts = union([...l.ghosts, { from, to }]);
  }
  dispatch(state.update({ effects: setLayers.of({ ...l, ghosts }) }));
  return true;
};

/**
 * Ghosts `from`–`to`. Null where any of it is ghosted already, or where it covers only part of an
 * alternative: such a ghost is lost on save.
 */
export function ghostRange(state: EditorState, from: number, to: number): TransactionSpec | null {
  const l = layersOf(state);
  if (from >= to || l.ghosts.some((g) => g.from < to && g.to > from)) return null;
  if (cutsAlternative(state, from, to)) return null;
  return { effects: setLayers.of({ ...l, ghosts: union([...l.ghosts, { from, to }]) }) };
}

export function reviveAt(state: EditorState, pos: number): TransactionSpec | null {
  const g = ghostAt(state, pos);
  const l = layersOf(state);
  return g ? { effects: setLayers.of({ ...l, ghosts: l.ghosts.filter((x) => x !== g) }) } : null;
}

export const hasGhosts = (state: EditorState) => layersOf(state).ghosts.length > 0;

export function reviveAll(state: EditorState): TransactionSpec | null {
  return hasGhosts(state) ? { effects: setLayers.of({ ...layersOf(state), ghosts: [] }) } : null;
}

/** Deletes spans of text without leaving a double space behind. */
export function deleteSpans(state: EditorState, spans: Span[]): ChangeSpec[] {
  return spans.map((s) => {
    const line = state.doc.lineAt(s.from);
    const before = s.from > line.from ? state.doc.sliceString(s.from - 1, s.from) : " ";
    const after = s.to < line.to ? state.doc.sliceString(s.to, s.to + 1) : "";
    return { from: s.from, to: before === " " && after === " " ? s.to + 1 : s.to };
  });
}

/**
 * Deletes a word or phrase and tidies around it: one space between words, no space before
 * punctuation, no comma left alone, and a capital where a sentence now starts.
 */
export function removeSpan(state: EditorState, span: Span): TransactionSpec {
  const line = state.doc.lineAt(span.from);
  const text = line.text;
  let a = span.from - line.from;
  let b = span.to - line.from;
  const starts = /(?:^|[.!?]["'”’)]*\s+)$/u.test(text.slice(0, a).replace(/^[ \t]*(?:>\s*|[-*+]\s+|\d+[.)]\s+)*/u, ""));
  if (text.slice(a - 2, a) === ", " && text[b] === ",") [a, b] = [a - 2, b + 1]; // "It is, basically, done."
  else if (starts && text.slice(b, b + 2) === ", ") b += 1; // "Basically, it is done."
  if (text[a - 1] === " " && (text[b] === " " || b === text.length || /[.,;:!?)\]]/.test(text[b]))) a -= 1;
  else if (text[b] === " " && (a === 0 || starts)) b += 1;
  const changes: ChangeSpec[] = [{ from: line.from + a, to: line.from + b }];
  // The next word starts the sentence now.
  const next = text.slice(b).match(/^\s*(\p{Ll})/u);
  if (starts && next) {
    const at = line.from + b + next[0].length - 1;
    changes.push({ from: at, to: at + 1, insert: next[1].toUpperCase() });
  }
  return { changes };
}

/** Deletes all ghosted text: "make the cuts". */
export function deleteGhosts(state: EditorState): TransactionSpec | null {
  const { ghosts } = layersOf(state);
  return ghosts.length ? { changes: deleteSpans(state, ghosts) } : null;
}

// ---------------------------------------------------------------------------
// Overflow and counting

export function takeSelectionText(state: EditorState): { spec: TransactionSpec; text: string } | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  return { spec: { changes: { from, to }, scrollIntoView: true }, text: state.doc.sliceString(from, to) };
}

export function countWords(state: EditorState): { words: number; chars: number } {
  let text = state.doc.toString();
  // Ghosted text doesn't count.
  for (const g of [...layersOf(state).ghosts].sort((a, b) => b.from - a.from)) {
    text = `${text.slice(0, g.from)} ${text.slice(g.to)}`;
  }
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return { words, chars: text.replace(/\s/g, "").length };
}
