import { EditorSelection, EditorState, StateField, Text, TransactionSpec } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { checkPunctuation, Mistake } from "../prose";
import { fitFix, pageText } from "./highlights";
import { layersOf } from "./layers";

// Proofing: punctuation mistakes (src/prose), marked as you write with a dotted
// underline, like spelling, with Review open or closed. Most have one right fix, which replaces the
// text. Nothing here is saved to the file.

interface ProofingState {
  /** In page order. */
  mistakes: readonly Mistake[];
  /** The caret while you type or delete, and while it stays in a mistake that waits for it. */
  typing: number | null;
  decos: DecorationSet;
}

const mark = Decoration.mark({ class: "pn" });

/**
 * Whether a mistake waits for the caret at `at`, as you may not be done: the caret is in it, or
 * after a lone opening bracket or quote in the same sentence.
 */
function waits(doc: Text, m: Mistake, at: number | null): boolean {
  if (at === null) return false;
  if (m.from <= at && at <= m.to) return true;
  // A sentence end, a blank line, or the next list item or quote ends the wait.
  const between = doc.sliceString(m.to, at);
  return Boolean(m.opens) && at > m.to && !/[.!?]["”’)]*\s|\n\s*\n|\n\s*(?:[-*+>]|\d+[.)])\s/.test(between);
}

function draw(s: Omit<ProofingState, "decos">, doc: Text): ProofingState {
  const shown = s.mistakes.filter((m) => !waits(doc, m, s.typing));
  return { ...s, decos: Decoration.set(shown.map((m) => mark.range(m.from, m.to))) };
}

const check = (state: EditorState) => checkPunctuation(pageText(state), state.doc.toString());

export const proofingField = StateField.define<ProofingState>({
  create: (state) => draw({ mistakes: check(state), typing: null }, state.doc),
  update(prev, tr) {
    const { doc } = tr.state;
    const mistakes = tr.docChanged || layersOf(tr.startState) !== layersOf(tr.state) ? check(tr.state) : prev.mistakes;
    const sel = tr.newSelection.main;
    let typing = prev.typing;
    if (tr.docChanged) typing = sel.empty && (tr.isUserEvent("input") || tr.isUserEvent("delete")) ? sel.head : null;
    // Moving the caret shows the mistakes it leaves.
    else if (tr.selection) typing = typing !== null && sel.empty && mistakes.some((m) => waits(doc, m, typing) && waits(doc, m, sel.head)) ? sel.head : null;
    return mistakes === prev.mistakes && typing === prev.typing ? prev : draw({ mistakes, typing }, doc);
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decos),
});

/** The punctuation mistakes on the page, in page order, also the one being typed. */
export const punctuationMistakes = (state: EditorState): readonly Mistake[] => state.field(proofingField, false)?.mistakes ?? [];

/** The mistake at `pos` that shows: not one that waits for you. */
export function punctuationAt(state: EditorState, pos: number): Mistake | null {
  const s = state.field(proofingField, false);
  return s?.mistakes.find((m) => m.from <= pos && pos <= m.to && !waits(state.doc, m, s.typing)) ?? null;
}

/**
 * Puts the fix in place of the mistake, with the caret after it, as its own undo step. Null when it
 * has no fix, or the fix has no place, as over an alternative or code (see fitFix).
 */
export function fixPunctuation(state: EditorState, mistake: Mistake): TransactionSpec | null {
  const fit = mistake.fix ? fitFix(state, mistake.from, mistake.to, mistake.fix) : null;
  if (!fit) return null;
  return {
    changes: { from: fit.from, to: fit.to, insert: fit.fix },
    selection: EditorSelection.cursor(fit.from + fit.fix.length),
    userEvent: "punctuation",
  };
}

/** Punctuation marks, as you write. */
export const proofing = () => proofingField;
