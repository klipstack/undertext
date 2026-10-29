import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { ChangeSet, EditorSelection, EditorState, StateEffect, StateField, TransactionSpec } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { checkPage, Issue, Kind, Report } from "../prose";
import { articleFix, BLOCK_START, leadLength, touchesCode } from "./commands";
import { Alt, newId } from "./format";
import { layersOf, mapLayers, setLayers } from "./layers";

// Highlights: hard sentences, weakeners, and simpler words (src/prose), and the
// writing issues Claude finds on request. The checks always run, so the top bar can show the
// grade. They show on the page only while Review is open, which is Hemingway's Edit mode.
// Nothing here is saved to the file or changes the text, until you use a fix.

export interface HighlightSettings {
  on: boolean;
  /** Kinds that are counted but not drawn. */
  hidden: readonly Kind[];
}

/** A mistake Claude found: grammar, spelling, or a wrong word. `fix` replaces the text, or is empty when there is none. */
export interface WritingIssue extends Issue {
  kind: "grammar";
  fix: string;
}

interface HighlightState extends HighlightSettings {
  report: Report;
  /** Null until Claude has looked at the page. */
  writing: WritingIssue[] | null;
  decos: DecorationSet;
}

const OFF: HighlightSettings = { on: false, hidden: [] };
const settingsEffect = StateEffect.define<Partial<HighlightSettings>>();
const writingEffect = StateEffect.define<WritingIssue[] | null>();
/** Issues an edit dropped, back with its undo. History maps it when it joins that edit with the one before. */
const restoreEffect = StateEffect.define<WritingIssue[]>({
  map: (issues, mapping) =>
    issues.map((i) => ({ ...i, from: mapping.mapPos(i.from, 1), to: mapping.mapPos(i.to, -1) })).filter((i) => i.from < i.to),
});

// One decoration per kind, so a keystroke builds no new ones. A click on a mark explains it, in
// the popover (src/editor/popover.ts).
const marks = new Map<string, Decoration>();
function markFor(issue: Issue): Decoration {
  let mark = marks.get(issue.kind);
  if (!mark) {
    mark = Decoration.mark({ class: `hl hl-${issue.kind}` });
    marks.set(issue.kind, mark);
  }
  return mark;
}

/** The page text with ghosts blanked out. Ghosted text doesn't count, as in the word count. */
export function pageText(state: EditorState): string {
  let text = state.doc.toString();
  for (const g of layersOf(state).ghosts) {
    text = text.slice(0, g.from) + text.slice(g.from, g.to).replace(/[^\n]/g, " ") + text.slice(g.to);
  }
  return text;
}

function draw(s: Omit<HighlightState, "decos">): HighlightState {
  if (!s.on) return { ...s, decos: Decoration.none };
  const shown = [...s.report.issues, ...(s.writing ?? [])].filter((i) => !s.hidden.includes(i.kind));
  return { ...s, decos: Decoration.set(shown.map((i) => markFor(i).range(i.from, i.to)), true) };
}

/** Whether an edit touches an issue's text, which drops it. */
function touches(changes: ChangeSet, i: { from: number; to: number }): boolean {
  let hit = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA < i.to && toA > i.from) hit = true;
  });
  return hit;
}

/** The issues an edit drops, as using a fix does, come back with its undo. */
const restoreWriting = invertedEffects.of((tr) => {
  const dropped = tr.docChanged ? (tr.startState.field(highlightsField, false)?.writing ?? []).filter((i) => touches(tr.changes, i)) : [];
  return dropped.length ? [restoreEffect.of(dropped)] : [];
});

export const highlightsField = StateField.define<HighlightState>({
  create: (state) => draw({ ...OFF, report: checkPage(pageText(state)), writing: null }),
  update(prev, tr) {
    let next = prev;
    let changed = false;
    if (tr.docChanged || layersOf(tr.startState) !== layersOf(tr.state)) {
      next = { ...next, report: checkPage(pageText(tr.state)), writing: mapWriting(prev.writing, tr.changes) };
      changed = true;
    }
    for (const e of tr.effects) {
      if (e.is(settingsEffect)) next = { ...next, ...e.value };
      // An issue placed on another version of the page would break every later edit.
      else if (e.is(writingEffect)) next = { ...next, writing: e.value && e.value.filter((i) => i.to <= tr.state.doc.length) };
      // A newer list may have come since: the issues come back beside it, where they don't overlap it.
      else if (e.is(restoreEffect) && next.writing) {
        const now = next.writing;
        const back = e.value.filter((i) => i.to <= tr.state.doc.length && !now.some((n) => n.from < i.to && i.from < n.to));
        next = { ...next, writing: [...now, ...back].sort((a, b) => a.from - b.from) };
      } else continue;
      changed = true;
    }
    return changed ? draw(next) : prev;
  },
  provide: (f) => [EditorView.decorations.from(f, (s) => s.decos), restoreWriting],
});

/** Moves writing issues with an edit. An edit that touches an issue's text drops it. */
function mapWriting(writing: WritingIssue[] | null, changes: ChangeSet): WritingIssue[] | null {
  if (!writing || changes.empty) return writing;
  return writing.filter((i) => !touches(changes, i)).map((i) => ({ ...i, from: changes.mapPos(i.from, 1), to: changes.mapPos(i.to, -1) }));
}

export const highlights = (settings: HighlightSettings = OFF) =>
  highlightsField.init((state) => draw({ ...settings, report: checkPage(pageText(state)), writing: null }));

export const setHighlights = (settings: Partial<HighlightSettings>): TransactionSpec => ({
  effects: settingsEffect.of(settings),
});

/** Claude's writing issues, in page order. Null forgets them. */
export const setWritingIssues = (issues: WritingIssue[] | null): TransactionSpec => ({
  effects: writingEffect.of(issues && [...issues].sort((a, b) => a.from - b.from)),
});

/** The report of the live checks. It is there with Review closed too, for the top bar. */
export function highlightReport(state: EditorState): Report | null {
  return state.field(highlightsField, false)?.report ?? null;
}

/** Claude's writing issues, or null when it hasn't looked at the page. */
export function writingIssues(state: EditorState): WritingIssue[] | null {
  return state.field(highlightsField, false)?.writing ?? null;
}

/** Whether Review is open, so its marks and the popover show. */
export const reviewOpen = (state: EditorState) => state.field(highlightsField, false)?.on ?? false;

/** The marks on the page while Review is open, writing issues first, without hidden kinds. */
export function shownIssues(state: EditorState): Issue[] {
  const h = state.field(highlightsField, false);
  if (!h?.on) return [];
  return [...(h.writing ?? []), ...h.report.issues].filter((i) => !h.hidden.includes(i.kind));
}

/**
 * The mark at `pos` that shows, while Review is open: a writing issue first, as it has a fix, then
 * the shortest marked word or phrase, then the sentence around it.
 */
export function issueAt(state: EditorState, pos: number): Issue | null {
  const here = shownIssues(state).filter((i) => i.from <= pos && pos <= i.to);
  const words = here.filter((i) => i.kind !== "hard" && i.kind !== "veryHard");
  const shortest = words.reduce<Issue | null>((a, b) => (a && a.to - a.from <= b.to - b.from ? a : b), null);
  return here.find((i) => i.kind === "grammar") ?? shortest ?? here[0] ?? null;
}

/** The next or previous shown mark of these kinds from the caret, wrapping around. */
export function nextIssue(state: EditorState, kinds: readonly Kind[], dir: 1 | -1): Issue | null {
  const list = shownIssues(state)
    .filter((i) => kinds.includes(i.kind))
    .sort((a, b) => a.from - b.from);
  if (!list.length) return null;
  const head = state.selection.main.head;
  let index = dir > 0 ? list.findIndex((i) => i.from > head) : list.findLastIndex((i) => i.from < head);
  if (index < 0) index = dir > 0 ? 0 : list.length - 1;
  return list[index];
}

/** Moves the caret to the next or previous shown mark of these kinds, in mid-window. Null when there is none. */
export function jumpToIssue(state: EditorState, kinds: readonly Kind[], dir: 1 | -1): TransactionSpec | null {
  const issue = nextIssue(state, kinds, dir);
  if (!issue) return null;
  return { selection: EditorSelection.cursor(issue.from), effects: EditorView.scrollIntoView(issue.from, { y: "center" }) };
}


/**
 * Where a fix of `from`–`to` can go. A suggestion's fix becomes an alternative, and the file format
 * trims each variant, so a space at either edge would be lost on save: "the the " → "the " becomes
 * "the the" → "the", and "ended.Next" → "ended. Next" takes in the whole word. Null when the fix
 * changes nothing, or would leave its line, start a line with Markdown markup, cut into a ghost or
 * an alternative, touch code, or add or remove a backtick: as an alternative, each of those would
 * save a different page. A writing issue's fix, which replaces the words, keeps to the same rules.
 */
export function fitFix(state: EditorState, from: number, to: number, fix: string): { from: number; to: number; fix: string } | null {
  const line = state.doc.lineAt(from);
  if (to > line.to || /[\r\n]/.test(fix)) return null;
  const text = line.text;
  const space = (c: string | undefined) => c === " " || c === "\t";
  let a = from - line.from;
  let b = to - line.from;
  let insert = fix;
  // Spaces both sides share stay outside the alternative.
  while (a < b && space(text[a]) && text[a] === insert[0]) [a, insert] = [a + 1, insert.slice(1)];
  while (a < b && space(text[b - 1]) && text[b - 1] === insert.at(-1)) [b, insert] = [b - 1, insert.slice(0, -1)];
  // Otherwise take in the word on that side, and the spaces before it.
  if (a === b || !insert || space(text[a]) || space(insert[0])) {
    const start = a;
    while (a > 0 && space(text[a - 1])) a--;
    while (a > 0 && !space(text[a - 1])) a--;
    insert = text.slice(a, start) + insert;
  }
  if (a === b || !insert || space(text[b - 1]) || space(insert.at(-1))) {
    const end = b;
    while (b < text.length && space(text[b])) b++;
    while (b < text.length && !space(text[b])) b++;
    insert += text.slice(end, b);
  }
  const original = text.slice(a, b);
  const edge = (s: string) => !s.trim() || s !== s.trim();
  if (edge(original) || edge(insert) || original === insert) return null;
  if (/`/.test(original + insert)) return null;
  if (leadLength(text) >= a && [original, insert].some((s) => BLOCK_START.test(s))) return null;
  const range = { from: line.from + a, to: line.from + b };
  const cuts = (r: { from: number; to: number }) => r.from < range.to && r.to > range.from;
  const l = layersOf(state);
  if (l.ghosts.some((g) => cuts(g) && (g.from > range.from || g.to < range.to))) return null;
  if (l.alts.some(cuts) || touchesCode(state, range.from, range.to)) return null;
  return { ...range, fix: insert };
}

/**
 * Uses a mark's fix. Claude's writing issue is a mistake, so its fix replaces the words. A
 * suggestion is a style choice, so it becomes an alternative with the fix active and the original
 * kept. Null when the mark has no fix, or the fix has no place (see fitFix).
 */
export function applyFix(state: EditorState, issue: Issue): TransactionSpec | null {
  const fit = issue.fix ? fitFix(state, issue.from, issue.to, issue.fix) : null;
  if (!fit) return null;
  const { fix } = fit;
  const original = state.doc.sliceString(fit.from, fit.to);
  // "An initial test" becomes "a first test", as switching an alternative's variant does.
  const article = articleFix(state, fit.from, fix);
  const changes = state.changes([...(article ? [article] : []), { from: fit.from, to: fit.to, insert: fix }]);
  if (issue.kind === "grammar") return { changes };
  const mapped = mapLayers(layersOf(state), changes);
  const from = changes.mapPos(fit.from, -1);
  const alt: Alt = { from, to: from + fix.length, id: newId(), variants: [original, fix], active: 1, ai: [fix] };
  return {
    changes,
    effects: setLayers.of({ ...mapped, alts: [...mapped.alts, alt].sort((x, y) => x.from - y.from) }),
  };
}

/** The "Use all" button: "Use 1 fix", "Use all 3 fixes". */
export const useAllLabel = (n: number) => (n === 1 ? "Use 1 fix" : `Use all ${n} fixes`);

/**
 * The part of an edit that changes the text, so marks beside it stay. It keeps at least one
 * character of `issue`, so the issue's own mark goes.
 */
function narrow(state: EditorState, edit: { from: number; to: number; insert: string }, issue: { from: number; to: number }) {
  let { from, to, insert } = edit;
  const old = state.doc.sliceString(from, to);
  let head = 0;
  while (head < old.length && head < insert.length && old[head] === insert[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < insert.length - head && old.at(-1 - tail) === insert.at(-1 - tail)) tail++;
  from += head;
  to -= tail;
  insert = insert.slice(head, insert.length - tail);
  if (from >= issue.to) {
    insert = state.doc.sliceString(issue.to - 1, from) + insert;
    from = issue.to - 1;
  }
  if (to <= issue.from) {
    insert += state.doc.sliceString(to, issue.from + 1);
    to = issue.from + 1;
  }
  return { from, to, insert };
}

/**
 * "Use all": every shown writing issue's fix that fits, in one change and its own undo step, so one
 * ⌘Z brings the words and the marks back. An issue with no fix, or one that doesn't fit or overlaps
 * an earlier fix, stays marked unless its words change. Null when no fix fits.
 */
export function applyAllFixes(state: EditorState): { spec: TransactionSpec; count: number } | null {
  const taken: { from: number; to: number }[] = [];
  const edits: { from: number; to: number; insert: string }[] = [];
  let count = 0;
  for (const issue of shownIssues(state)) {
    if (issue.kind !== "grammar") continue;
    const fit = issue.fix ? fitFix(state, issue.from, issue.to, issue.fix) : null;
    if (!fit) continue;
    const article = articleFix(state, fit.from, fit.fix);
    const mine = [...(article ? [article] : []), fit];
    if (mine.some((m) => taken.some((t) => t.from < m.to && m.from < t.to))) continue;
    taken.push(...mine);
    if (article) edits.push(narrow(state, article, article));
    edits.push(narrow(state, { ...fit, insert: fit.fix }, issue));
    count++;
  }
  return count ? { spec: { changes: edits, annotations: isolateHistory.of("full") }, count } : null;
}
