import { ChangeSet, EditorSelection, EditorState, Facet, StateEffect, StateField, TransactionSpec } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { proseBlocks } from "../prose";
import { wordRangeAt } from "./commands";
import { pageText } from "./highlights";
import { layersOf } from "./layers";

// Spelling: words the Mac's spell checker doesn't know, underlined as you write. The checker runs
// in Rust (src-tauri/src/spelling.rs) and answers later, so its answers are kept by paragraph text:
// an answer for a paragraph that changed meanwhile waits for the next check. Code, link addresses,
// HTML, and ghosted text aren't checked. Nothing here is saved to the file.

/** What the checker found in one text: offsets in it, and the language it checked in. */
export interface Checked {
  language: string | null;
  words: [number, number][];
}

/** The Mac's spell checker, or a stand-in. */
export interface Speller {
  check(texts: string[], sample: string): Promise<Checked[]>;
  guesses(word: string, language: string | null): Promise<string[]>;
  learn(word: string): void;
  /** Whether the word is in the Mac's own word list. */
  learned(word: string): Promise<boolean>;
  unlearn(word: string): Promise<void>;
}

export interface Misspelling {
  from: number;
  to: number;
  word: string;
  language: string | null;
}

interface SpellingState {
  /** The checker's answers, by block text. Only the page's blocks are kept. */
  cache: ReadonlyMap<string, Checked>;
  /** In page order. */
  words: readonly Misspelling[];
  /** Words learned since the page opened, in lower case. The checker knows them too, but its old answers don't. */
  learned: ReadonlySet<string>;
  guesses: ReadonlyMap<string, readonly string[]>;
  /** The caret while you type or delete. A word it touches isn't marked yet: you may not be done. */
  typing: number | null;
  decos: DecorationSet;
}

const checkedEffect = StateEffect.define<{ text: string; checked: Checked }[]>();
const learnEffect = StateEffect.define<string>();
const unlearnEffect = StateEffect.define<string>();
const guessesEffect = StateEffect.define<{ word: string; guesses: readonly string[] }>();

const mark = Decoration.mark({ class: "sp" });

/** Markup inside prose that the checker would read as part of a word, as in "_italc_". */
const MARKS = /[*_~\\]/g;

/**
 * The page's prose, block by block, as the checker gets it: paragraphs, list items, quotes, and
 * headings, with markup and ghosts blanked out, so an offset in a block's text is an offset in the
 * page from its `from`.
 */
export function spellingBlocks(state: EditorState): { from: number; text: string }[] {
  return proseBlocks(pageText(state), { headings: true }).map((b) => ({ from: b.from, text: b.text.replace(MARKS, " ") }));
}

const touching = (w: { from: number; to: number }, typing: number | null) => typing !== null && w.from <= typing && typing <= w.to;

function draw(s: Omit<SpellingState, "decos">): SpellingState {
  const shown = s.words.filter((w) => !touching(w, s.typing));
  return { ...s, decos: Decoration.set(shown.map((w) => mark.range(w.from, w.to))) };
}

/** Moves the marks with an edit. An edit in a word or right beside it makes another word: its mark goes until the next check. */
function mapWords(words: readonly Misspelling[], changes: ChangeSet): readonly Misspelling[] {
  if (changes.empty) return words;
  return words.flatMap((w) => {
    let touched = false;
    changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= w.to && toA >= w.from) touched = true;
    });
    return touched ? [] : [{ ...w, from: changes.mapPos(w.from, 1), to: changes.mapPos(w.to, -1) }];
  });
}

/** The marks from the checker's answers, for the blocks it has answered. Other blocks keep their marks. */
function fromCache(state: EditorState, prev: readonly Misspelling[], answers: ReadonlyMap<string, Checked>, learned: ReadonlySet<string>) {
  const cache = new Map<string, Checked>();
  const words: Misspelling[] = [];
  for (const b of spellingBlocks(state)) {
    const end = b.from + b.text.length;
    const checked = answers.get(b.text);
    if (!checked) {
      words.push(...prev.filter((w) => w.from >= b.from && w.to <= end));
      continue;
    }
    cache.set(b.text, checked);
    for (const [from, to] of checked.words) {
      words.push({ from: b.from + from, to: b.from + to, word: b.text.slice(from, to), language: checked.language });
    }
  }
  return { cache, words: words.filter((w) => !learned.has(w.word.toLowerCase())) };
}

export const spellingField = StateField.define<SpellingState>({
  create: () => draw({ cache: new Map(), words: [], learned: new Set(), guesses: new Map(), typing: null }),
  update(prev, tr) {
    let next: Omit<SpellingState, "decos"> = prev;
    if (tr.docChanged) next = { ...next, words: mapWords(prev.words, tr.changes) };
    const sel = tr.newSelection.main;
    const typing = tr.docChanged && sel.empty && (tr.isUserEvent("input") || tr.isUserEvent("delete")) ? sel.head : null;
    if (typing !== prev.typing && (tr.docChanged || tr.selection)) next = { ...next, typing };
    for (const e of tr.effects) {
      if (e.is(checkedEffect)) {
        const answers = new Map(next.cache);
        for (const { text, checked } of e.value) answers.set(text, checked);
        next = { ...next, ...fromCache(tr.state, next.words, answers, next.learned) };
      } else if (e.is(learnEffect)) {
        const learned = e.value.toLowerCase();
        next = { ...next, learned: new Set(next.learned).add(learned), words: next.words.filter((w) => w.word.toLowerCase() !== learned) };
      } else if (e.is(unlearnEffect)) {
        // The checker passed the word in these answers, or they were hidden as learned: ask again.
        const word = e.value.toLowerCase();
        const learned = new Set(next.learned);
        learned.delete(word);
        const cache = new Map([...next.cache].filter(([text]) => !text.toLowerCase().includes(word)));
        next = { ...next, learned, cache };
      } else if (e.is(guessesEffect)) {
        next = { ...next, guesses: new Map(next.guesses).set(e.value.word, e.value.guesses) };
      }
    }
    return next === prev ? prev : draw(next);
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decos),
});

/** What the checker found, for texts as spellingBlocks gave them. An answer for a text no longer on the page is dropped. */
export const spellingChecked = (answers: { text: string; checked: Checked }[]): TransactionSpec => ({
  effects: checkedEffect.of(answers),
});

/** The misspelled words, in page order. */
export const misspellings = (state: EditorState): readonly Misspelling[] => state.field(spellingField, false)?.words ?? [];

/** The misspelled word at `pos`, from its start to its end. */
export const misspellingAt = (state: EditorState, pos: number): Misspelling | null =>
  misspellings(state).find((w) => w.from <= pos && pos <= w.to) ?? null;

/** The checker's guesses for a word, best first. Null until they come. */
export const guessesFor = (state: EditorState, word: string): readonly string[] | null =>
  state.field(spellingField, false)?.guesses.get(word) ?? null;

export const setGuesses = (word: string, guesses: readonly string[]): TransactionSpec => ({
  effects: guessesEffect.of({ word, guesses }),
});

/**
 * Puts a guess in place of the word, with the caret after it. ⌘Z brings the word back. An
 * alternative or ghost around the word keeps it. Null when one cuts through the word, where a
 * save couldn't keep it.
 */
export function fixSpelling(state: EditorState, word: Misspelling, guess: string): TransactionSpec | null {
  if (state.doc.sliceString(word.from, word.to) !== word.word) return null;
  const l = layersOf(state);
  const cuts = (r: { from: number; to: number }) => r.from < word.to && r.to > word.from && (r.from > word.from || r.to < word.to);
  if ([...l.alts, ...l.ghosts].some(cuts)) return null;
  return {
    changes: { from: word.from, to: word.to, insert: guess },
    selection: EditorSelection.cursor(word.from + guess.length),
    // Its own undo step, even right after typing; and not typing, so the word is marked if still wrong.
    userEvent: "spelling",
  };
}

/** Teaches the Mac's checker a word, for every app, and unmarks it on the page in any case. */
export const learnSpelling = (word: string): TransactionSpec => ({ effects: learnEffect.of(word) });

/** Takes a word out of the Mac's own word list. The next check marks it, if it's misspelled. */
export const unlearnSpelling = (word: string): TransactionSpec => ({ effects: unlearnEffect.of(word) });

// ---------------------------------------------------------------------------
// Asking the checker

const spellerFacet = Facet.define<Speller, Speller | null>({ combine: (all) => all[0] ?? null });
/** Shows a line in the bar under the page. */
type Notice = (message: string) => void;
const noticeFacet = Facet.define<Notice, Notice | null>({ combine: (all) => all[0] ?? null });

/** What the bar says after "Learn spelling": the way back too, as ⌘Z can't undo it. */
export const learnedNotice = (word: string) => `Your Mac learned “${word}”, for every app. Right-click it to unlearn it.`;

/** After a pause in typing, so a keystroke never waits for the checker. */
const PAUSE = 400;
/** Enough of the page for the checker to tell its language. */
const SAMPLE = 2000;

/** The checker's guesses for a word, from the page's cache or from the checker. */
export async function loadGuesses(view: EditorView, word: Misspelling): Promise<readonly string[]> {
  const known = guessesFor(view.state, word.word);
  const speller = view.state.facet(spellerFacet);
  if (known || !speller) return known ?? [];
  const guesses = await speller.guesses(word.word, word.language);
  view.dispatch(setGuesses(word.word, guesses));
  return guesses;
}

/** The word at `pos` when it's in the Mac's own word list, for "Unlearn spelling". Null on a misspelled word. */
export async function learnedWordAt(view: EditorView, pos: number): Promise<string | null> {
  const speller = view.state.facet(spellerFacet);
  const range = wordRangeAt(view.state, pos);
  // Quotes and dashes around the word aren't part of it.
  const word = range && view.state.doc.sliceString(range.from, range.to).replace(/^['’-]+|['’-]+$/g, "");
  if (!speller || !word || misspellingAt(view.state, pos)) return null;
  return (await speller.learned(word)) ? word : null;
}

const checker = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    /** Texts sent to the checker and not answered yet. */
    asked = new Set<string>();
    guessing = new Set<string>();
    /** Unlearning calls not done yet. A check before they end would get the old answer, and keep it. */
    unlearning = 0;
    /** Whether the page changed since the last check. */
    edited = false;
    gone = false;

    constructor(readonly view: EditorView) {
      this.schedule(0);
    }

    update(u: ViewUpdate) {
      const speller = u.state.facet(spellerFacet);
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(learnEffect)) {
            speller?.learn(e.value);
            u.state.facet(noticeFacet)?.(learnedNotice(e.value));
          } else if (e.is(unlearnEffect) && speller) {
            this.unlearning++;
            speller
              .unlearn(e.value)
              .catch((err) => console.warn("Unlearning a word failed:", err))
              .finally(() => {
                this.unlearning--;
                this.schedule(0);
              });
          }
        }
      }
      if (u.docChanged || layersOf(u.startState) !== layersOf(u.state)) {
        this.edited = true;
        this.schedule(PAUSE);
      }
      if (u.selectionSet) this.prefetch();
    }

    schedule(ms: number) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check(), ms);
    }

    check() {
      if (!this.view.state.facet(spellerFacet) || this.gone || this.unlearning) return;
      // Marks for text the checker has answered already, as after an undo, come from its answers.
      if (this.edited) this.view.dispatch(spellingChecked([]));
      this.edited = false;
      const { state } = this.view;
      const speller = state.facet(spellerFacet)!;
      const { cache } = state.field(spellingField);
      const blocks = spellingBlocks(state);
      const texts = [...new Set(blocks.map((b) => b.text))].filter((t) => /\p{L}/u.test(t) && !cache.has(t) && !this.asked.has(t));
      if (!texts.length) return;
      for (const t of texts) this.asked.add(t);
      let sample = "";
      for (const b of blocks) if ((sample += `${b.text}\n\n`).length > SAMPLE) break;
      speller
        .check(texts, sample)
        .then((found) => {
          if (!this.gone) this.view.dispatch(spellingChecked(texts.map((text, i) => ({ text, checked: found[i] }))));
        })
        .catch((err) => console.warn("Spelling check failed:", err))
        .finally(() => texts.forEach((t) => this.asked.delete(t)));
    }

    /** The guesses for the word at the caret, so its popover and menu have them at once. */
    prefetch() {
      const sel = this.view.state.selection.main;
      const word = sel.empty ? misspellingAt(this.view.state, sel.head) : null;
      if (!word || this.guessing.has(word.word)) return;
      this.guessing.add(word.word);
      loadGuesses(this.view, word)
        .catch((err) => console.warn("Spelling guesses failed:", err))
        .finally(() => this.guessing.delete(word.word));
    }

    destroy() {
      this.gone = true;
      clearTimeout(this.timer);
    }
  },
);

/** Spelling marks. With a speller, the page is checked as you write. `notice` shows a line in the bar under the page. */
export const spelling = (speller?: Speller, notice?: Notice) => [
  spellingField,
  speller ? [spellerFacet.of(speller), checker] : [],
  notice ? noticeFacet.of(notice) : [],
];
