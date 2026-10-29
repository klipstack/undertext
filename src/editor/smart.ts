import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { pageDashStyle } from "../prose";
import { leadLength } from "./commands";
import { pageText } from "./highlights";
import { layersOf } from "./layers";

// Smart quotes and dashes as you type: " and ' become curly, and a second - turns "--" into a dash.
// Not in code, HTML, or a link's address, and hyphens not at the start of a line or in a table,
// where they make a rule or a column. Each change is its own undo step, so ⌘Z right after brings
// back what you typed. Pasted text stays as it is: CodeMirror only asks the input handler about
// typing.

const TYPED = new Set(['"', "'", "-", ">"]);

/** Syntax whose text stays as typed: code, HTML, comments, addresses, and link definitions. */
const KEEP = new Set([
  "InlineCode",
  "CodeText",
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "HTMLTag",
  "Comment",
  "CommentBlock",
  "ProcessingInstruction",
  "URL",
  "Autolink",
  "LinkReference",
]);

/** Whether the character at `at` is inside syntax that stays as typed. */
function inKept(state: EditorState, at: number): boolean {
  const tree = ensureSyntaxTree(state, at + 1, 200) ?? syntaxTree(state);
  for (let node: { name: string; parent: unknown } | null = tree.resolveInner(at, 1); node; node = node.parent as typeof node) {
    if (KEEP.has(node.name)) return true;
  }
  return false;
}

/**
 * Whether the character at `at` is in markup the parser can't see yet, as it is still being typed:
 * inline code, a tag, a comment, or a link's address in its paragraph, or a bare address or link
 * definition on its line.
 */
function inOpenMarkup(state: EditorState, at: number): boolean {
  const back = state.doc.sliceString(Math.max(0, at - 1000), at);
  // The paragraph so far, with its finished code spans blanked out.
  const para = back.slice(back.lastIndexOf("\n\n") + 1).replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));
  if (para.includes("`") || /<[a-z/!?][^<>]*$/i.test(para) || para.lastIndexOf("<!--") > para.lastIndexOf("-->")) return true;
  if (/\]\([^)]*$/.test(para)) return true;
  const line = state.doc.lineAt(at);
  const word = /\S*$/.exec(line.text.slice(Math.max(0, at - line.from - 200), at - line.from))![0];
  return /:\/\/|^\(?www\.|@/i.test(word) || /^\s*\[(?!\^)[^\]]+\]:/.test(line.text);
}

/**
 * The curly quote or the dash for the character just typed before `pos`, as a change, or null when
 * it stays. A quote opens at the start of a line, after a space, an opening bracket or quote, a
 * quote marker, or a tag, and closes otherwise; an apostrophe is a closing quote. "--" becomes an
 * em dash, or an en dash on a page of spaced en dashes or once a number follows a number, and back
 * to "-->" when ">" follows.
 */
export function smarten(state: EditorState, pos: number): TransactionSpec | null {
  const typed = state.doc.sliceString(pos - 1, pos);
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - 1 - line.from);
  if (!TYPED.has(typed) && !follows(before, typed)) return null;
  if (inKept(state, pos - 1) || inOpenMarkup(state, pos - 1)) return null;
  // A word after a dash and a closing quote shows the quote opens it: —”Go becomes —“Go. A
  // number after a dash after a number shows a range: 3—4 becomes 3–4.
  if (/\p{L}/u.test(typed)) return own(pos - 2, pos - 1, before.endsWith("”") ? "“" : "‘");
  if (/\d/.test(typed)) return own(pos - 2, pos - 1, "–");
  // An escaped quote stays as typed.
  if (before.endsWith("\\")) return null;
  if (typed === ">") return /[—–]$/.test(before) ? own(pos - 2, pos, "-->") : null;
  if (typed === "-") {
    // "--", but not "---", not at the start of a line or after a list or quote marker, and not in a
    // table: a row with a "|", or the one under it, which may not have its "|" yet.
    if (!before.endsWith("-") || before.endsWith("--") || before.endsWith("<-") || before.slice(leadLength(line.text)) === "-") return null;
    const above = line.number > 1 ? state.doc.line(line.number - 1).text : "";
    if (line.text.includes("|") || above.includes("|")) return null;
    // A ghost or an alternative that ends or starts between the hyphens would lose one. Hyphens
    // typed after an alternative join it, and its dash would too.
    const l = layersOf(state);
    if ([...l.alts, ...l.ghosts].some((r) => r.from === pos - 1 || r.to === pos - 1) || l.alts.some((a) => a.to === pos)) return null;
    const dash = pageDashStyle(pageText(state)) === "spacedEn" ? "–" : "—";
    return own(pos - 2, pos, dash);
  }
  // Emphasis marks don't count: *"Hi"* opens after the *. So does one after a quote marker or a tag.
  const prev = before.replace(/[*_~]+$/, "").at(-1);
  const opens = prev === undefined || /[\s([{“‘>]/.test(prev);
  const curly = typed === '"' ? (opens ? "“" : "”") : opens ? "‘" : "’";
  return own(pos - 1, pos, curly);
}

/** Whether a letter or digit just typed changes what comes before it: a quote after a dash, or a dash between numbers. */
const follows = (before: string, typed: string) =>
  (/\p{L}/u.test(typed) && /[—–][”’]$/.test(before)) || (/\d/.test(typed) && /\d—$/.test(before));

/** Curly quotes for the straight ones in `text`, by the same rules as typing them. */
export function curlQuotes(text: string): string {
  let out = "";
  for (const c of text) {
    const prev = out.replace(/[*_~]+$/, "").at(-1);
    const opens = prev === undefined || /[\s([{“‘>]/.test(prev);
    out += c === '"' ? (opens ? "“" : "”") : c === "'" ? (opens ? "‘" : "’") : c;
  }
  return out;
}

/** A change that is its own undo step. It counts as typing, so a mark at the caret still waits. */
const own = (from: number, to: number, insert: string): TransactionSpec => ({
  changes: { from, to, insert },
  annotations: isolateHistory.of("full"),
  userEvent: "input.type.smart",
});

/** The input handler: the typed key goes in as typed, then becomes curly or a dash, as a second step. */
export function smartInput(view: EditorView, from: number, _to: number, text: string, insert: () => TransactionSpec): boolean {
  if (view.composing || (!TYPED.has(text) && !follows(view.state.sliceDoc(Math.max(0, from - 2), from), text))) return false;
  view.dispatch(insert());
  const spec = smarten(view.state, view.state.selection.main.head);
  if (spec) view.dispatch(spec);
  return true;
}

export const smartTyping = EditorView.inputHandler.of(smartInput);
