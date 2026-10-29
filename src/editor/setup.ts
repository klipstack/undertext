import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec, StateCommand } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, keymap } from "@codemirror/view";
import { clipboard } from "./clipboard";
import {
  altInSelection,
  blockAt,
  countWords,
  cycleAtCaret,
  cycleVersionAtCaret,
  jumpToItem,
  rangeMarkdown,
  syncedVariants,
  ghostBlocked,
  toggleGhost,
  versionAt,
  wordRangeAt,
} from "./commands";
import { Layers, MARKDOWN_EXTENSIONS, serializePage } from "./format";
import { applyAllFixes, highlights, HighlightSettings, highlightReport, issueAt, REVIEW_KINDS, ReviewKind, writingIssues } from "./highlights";
import { inkLayers } from "./ink";
import { backspace, enter, setHeading, toggleBold, toggleCode, toggleItalic, toggleLink, toggleList } from "./keys";
import { jumpToLabSpan, keepCut, lab, labSpanAt, labSpans, labState } from "./lab";
import { layers, layersField, layersOf } from "./layers";
import { actionHint, actionsFor, markAtCaret, popover, popoverAt, RewriteTarget } from "./popover";
import { livePreview } from "./preview";
import { proofing } from "./proofing";
import { smartTyping } from "./smart";
import { Speller, spelling } from "./spelling";

export interface EditorHandlers {
  alternatives(): void;
  aiAlternatives(): void;
  lab(): void;
  stash(): void;
  fork(): void;
  escape(): boolean;
  /** Claude's rewrites of a marked sentence, from the popover. */
  rewrite(target: RewriteTarget): void;
  /** Says why a key did nothing, as the bar under the page does. */
  notice(message: string): void;
}

/**
 * ⌘/ on a proposed cut keeps the text. Anywhere else it ghosts or revives, or `notice` says why it
 * won't.
 */
export const ghostOrKeep =
  (notice: (message: string) => void): StateCommand =>
  (target) => {
    const { state, dispatch } = target;
    const cut = labSpanAt(state, state.selection.main.from, "cuts");
    if (cut) {
      dispatch(state.update(keepCut(cut)));
      return true;
    }
    const why = ghostBlocked(state);
    if (why) {
      notice(why);
      return true;
    }
    return toggleGhost(target);
  };

// ⌥J/⌥K cycle, ⌥⇧J/⌥⇧K cycle paragraph versions, ⌥L/⌥H jump between items.
// Match the physical key: Option changes e.key (⌥J types ∆). These keys are
// always consumed, so a stray ∆ never lands in the text.
let lastJump: number | null = null;
const optionKeys = EditorView.domEventHandlers({
  keydown(e, view) {
    if (!e.altKey || e.metaKey || e.ctrlKey) return false;
    const { state } = view;
    if (e.code === "KeyJ" || e.code === "KeyK") {
      const dir = e.code === "KeyJ" ? 1 : -1;
      const spec = e.shiftKey ? cycleVersionAtCaret(state, dir) : cycleAtCaret(state, dir);
      if (spec) view.dispatch(spec, { scrollIntoView: true });
    } else if ((e.code === "KeyL" || e.code === "KeyH") && !e.shiftKey) {
      const dir = e.code === "KeyL" ? 1 : -1;
      // While Lab results are showing, move between them instead.
      const labJump = jumpToLabSpan(state, dir);
      const jump = labJump ? null : jumpToItem(state, dir, lastJump);
      if (labJump) view.dispatch(labJump);
      else if (jump) {
        view.dispatch(jump.spec);
        lastJump = jump.index;
      }
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  },
});

/**
 * A drag always selects text, even from inside a selection: it never moves
 * the text. With the browser's drag cancelled, CodeMirror extends the
 * selection from where the mouse went down.
 */
const dragSelects = EditorView.domEventHandlers({
  dragstart(e) {
    e.preventDefault();
    return true;
  },
});

const theme = EditorView.theme({
  "&": { color: "inherit", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "transparent" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--accent)", marginLeft: "-1px" },
});

export function createEditorState(
  text: string,
  initial: Layers,
  handlers?: () => EditorHandlers,
  checks?: HighlightSettings,
  speller?: Speller,
): EditorState {
  const call = (fn: Exclude<keyof EditorHandlers, "rewrite" | "notice">) => () => {
    if (!handlers) return false;
    return handlers()[fn]() !== false;
  };
  return EditorState.create({
    doc: text,
    extensions: [
      history(),
      drawSelection({ cursorBlinkRate: 1060 }),
      dropCursor(),
      EditorView.lineWrapping,
      // Spelling is ours (./spelling.ts): WebKit's would mark code and Markdown, under its own menu.
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      EditorView.editorAttributes.of({ class: "page-text" }),
      markdown({ extensions: MARKDOWN_EXTENSIONS, addKeymap: false, completeHTMLTags: false }),
      layers(initial),
      lab,
      highlights(checks),
      spelling(speller, (message) => handlers?.().notice(message)),
      proofing(),
      smartTyping,
      popover(handlers && ((target) => handlers().rewrite(target))),
      livePreview,
      inkLayers,
      clipboard,
      dragSelects,
      optionKeys,
      Prec.high(
        keymap.of([
          { key: "Enter", run: enter },
          { key: "Shift-Enter", run: insertNewline },
          { key: "Backspace", run: backspace },
          { key: "Mod-b", run: toggleBold },
          { key: "Mod-i", run: toggleItalic },
          { key: "Mod-e", run: toggleCode },
          { key: "Shift-Mod-k", run: toggleLink },
          { key: "Mod-Alt-1", run: setHeading(1) },
          { key: "Mod-Alt-2", run: setHeading(2) },
          { key: "Mod-Alt-3", run: setHeading(3) },
          { key: "Mod-Alt-0", run: setHeading(0) },
          { key: "Shift-Mod-7", run: toggleList("ordered") },
          { key: "Shift-Mod-8", run: toggleList("bullet") },
          { key: "Shift-Mod-9", run: toggleList("task") },
          { key: "Mod-/", run: ghostOrKeep((message) => handlers?.().notice(message)) },
          { key: "Shift-Mod-a", run: call("alternatives") },
          { key: "Shift-Mod-g", run: call("aiAlternatives") },
          { key: "Shift-Mod-x", run: call("stash") },
          { key: "Shift-Mod-d", run: call("fork") },
          { key: "Escape", run: call("escape") },
        ]),
      ),
      keymap.of([...historyKeymap, ...standardKeymap]),
      theme,
    ],
  });
}

/** The file a save would write. */
export function pageMarkdown(state: EditorState, overflow: string): string {
  return serializePage({ text: state.doc.toString(), ...layersOf(state), overflow });
}

// ---------------------------------------------------------------------------
// Snapshot of the editor that the React chrome needs

export interface EditorInfo {
  words: number;
  chars: number;
  alt: { id: string; variants: string[]; active: number; ai: string[] } | null;
  candidate: { from: number; to: number; text: string } | null;
  /** The paragraph at the caret. `at` is where it starts. */
  para: { at: number; variants: string[]; active: number } | null;
  lab: {
    kind: "marks" | "cuts";
    label: string;
    percent?: number;
    count: number;
    /** The reason of the mark under the caret, if any. */
    here: string | null;
  } | null;
  /**
   * The live checks, and Claude's writing issues once it has looked (`ran`). While Review is open,
   * `here` says why the text at the caret is marked, and `fix` is its suggestion or correction.
   */
  checks: {
    grade: number | null;
    sentences: number;
    counts: Record<ReviewKind, number>;
    /** Weakener marks, each counted once, as Hemingway does. */
    weakeners: number;
    ran: boolean;
    here: string | null;
    fix: string | null;
    /** What using `fix` does: it replaces a mistake, or becomes an alternative. */
    fixHint: string | null;
    /** The first action at the caret when it isn't a fix, such as "Ghost it" or "Suggest rewrites". ⌥↩ runs it. */
    action: string | null;
    /** How many writing issue fixes "Use all" would use. */
    fixAll: number;
  } | null;
}

let lastCounted: { doc: unknown; layers: unknown; counts: { words: number; chars: number } } | null = null;

export function describe(state: EditorState): EditorInfo {
  const l = state.field(layersField);
  if (!lastCounted || lastCounted.doc !== state.doc || lastCounted.layers !== l) {
    lastCounted = { doc: state.doc, layers: l, counts: countWords(state) };
  }

  const a = altInSelection(state);
  const alt = a ? { id: a.id, variants: syncedVariants(state, a), active: a.active, ai: a.ai } : null;

  let candidate: EditorInfo["candidate"] = null;
  if (!alt) {
    const { from, to, empty } = state.selection.main;
    const range = empty ? wordRangeAt(state, from) : { from, to };
    const text = range ? state.doc.sliceString(range.from, range.to).trim() : "";
    if (range && text && !text.includes("\n")) candidate = { ...range, text };
  }

  let para: EditorInfo["para"] = null;
  const block = blockAt(state);
  if (block) {
    const current = rangeMarkdown(state, block.from, block.to);
    const v = versionAt(state);
    const variants = v ? [...v.variants] : [current];
    const active = v ? v.active : 0;
    variants[active] = current;
    para = { at: block.from, variants, active };
  }

  const ls = labState(state);
  const labInfo = ls.kind
    ? {
        kind: ls.kind,
        label: ls.meta?.label ?? "",
        percent: ls.meta?.percent,
        count: labSpans(state).length,
        here: labSpanAt(state, state.selection.main.from)?.reason ?? null,
      }
    : null;

  const report = highlightReport(state);
  let checks: EditorInfo["checks"] = null;
  if (report) {
    const counts = Object.fromEntries(REVIEW_KINDS.map((k) => [k, 0])) as Record<ReviewKind, number>;
    const writing = writingIssues(state);
    for (const i of [...report.issues, ...(writing ?? [])]) counts[i.kind] += 1;
    // The popover's mark when it's open, so the panel, the palette, and ⌥↩ all mean the same one.
    // Spelling and punctuation aren't Review's checks: their popover says all there is, and the
    // panel says nothing where ⌥↩ would fix one.
    const open = popoverAt(state);
    const caret = markAtCaret(state);
    const at = !caret || caret.kind === "spelling" || caret.kind === "punctuation" ? null : (open ?? issueAt(state, state.selection.main.head));
    const first = at && actionsFor(state, at)[0];
    // No fix to offer where it can't apply, such as over an alternative.
    const fix = first?.kind === "fix" ? first.label : null;
    checks = {
      grade: report.grade,
      sentences: report.sentences,
      counts,
      weakeners: report.weakeners,
      ran: writing !== null,
      here: at?.note ?? null,
      fix,
      fixHint: at && first?.kind === "fix" ? actionHint(at, first) : null,
      action: first && first.kind !== "fix" ? first.label : null,
      fixAll: writing?.length ? (applyAllFixes(state)?.count ?? 0) : 0,
    };
  }

  return { ...lastCounted.counts, alt, candidate, para, lab: labInfo, checks };
}
