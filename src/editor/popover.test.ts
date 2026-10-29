import { redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, showTooltip } from "@codemirror/view";
import { createAlt } from "./commands";
import { describe, expect, it } from "vitest";
import { parsePage } from "./format";
import { setHighlights, setWritingIssues, WritingIssue, writingIssues } from "./highlights";
import {
  actionHint,
  actionsFor,
  closePopover,
  firstAction,
  jumpToMark,
  openPopover,
  PopoverAction,
  popoverAt,
  popoverContent,
  rewriteRange,
  runAction,
  useFixAt,
  whyNoAction,
} from "./popover";
import { createEditorState, describe as describeEditor, EditorHandlers, pageMarkdown } from "./setup";
import { misspellings, setGuesses, spellingChecked } from "./spelling";

const stateFor = (md: string, on = true) => {
  const { text, alts, ghosts, versions } = parsePage(md);
  return createEditorState(text, { alts, ghosts, versions }, undefined, { on, hidden: [] });
};
const caret = (state: EditorState, pos: number) => state.update({ selection: EditorSelection.cursor(pos) }).state;
/** Puts the caret at `pos` and opens the popover there, as a click does. */
const click = (state: EditorState, pos: number) => {
  const next = caret(state, pos);
  const spec = openPopover(next);
  return spec ? next.update(spec).state : next;
};
/** The open popover's kind and the text it is about. */
const shown = (state: EditorState) => {
  const issue = popoverAt(state);
  return issue && [issue.kind, state.doc.sliceString(issue.from, issue.to)];
};
const undoRedo = (state: EditorState) => {
  const step = (cmd: typeof undo) => cmd({ state, dispatch: (tr: Transaction) => (state = tr.state) });
  step(undo);
  const undone = pageMarkdown(state, "");
  step(redo);
  return [undone, pageMarkdown(state, "")];
};

describe("the popover", () => {
  // "was quickly closed" at 9–27, "quickly" at 13–20.
  const PASSIVE = "The door was quickly closed.\n";

  it("opens on the innermost mark at the caret, only while Review is open", () => {
    expect(shown(click(stateFor(PASSIVE), 15))).toEqual(["adverb", "quickly"]);
    expect(shown(click(stateFor(PASSIVE), 10))).toEqual(["passive", "was quickly closed"]);
    expect(openPopover(caret(stateFor(PASSIVE), 1))).toBeNull();
    expect(openPopover(caret(stateFor(PASSIVE, false), 15))).toBeNull();
    expect(openPopover(stateFor(PASSIVE).update({ selection: EditorSelection.range(13, 20) }).state)).toBeNull();
  });

  it("stays on its mark while the caret is in it, and closes on anything else", () => {
    // "walked slowly" at 4–17.
    const open = click(stateFor("She walked slowly home.\n"), 6);
    expect(shown(open)).toEqual(["weakVerb", "walked slowly"]);
    expect(shown(caret(open, 14))).toEqual(["weakVerb", "walked slowly"]);
    expect(popoverAt(caret(open, 20))).toBeNull();
    expect(popoverAt(open.update({ selection: EditorSelection.range(4, 10) }).state)).toBeNull();
    expect(popoverAt(open.update({ changes: { from: 8, insert: "x" } }).state)).toBeNull();
    // Any edit closes it, even one that leaves its mark as it was.
    expect(popoverAt(open.update({ changes: { from: 23, insert: " Then." } }).state)).toBeNull();
    expect(popoverAt(open.update(closePopover).state)).toBeNull();
    expect(popoverAt(open.update(setHighlights({ on: false })).state)).toBeNull();
    expect(popoverAt(open.update(setHighlights({ hidden: ["weakVerb"] })).state)).toBeNull();
    // A change to the layers or to Claude's issues could change what it offers, so it closes.
    expect(popoverAt(open.update(createAlt(open, 4, 10)!.spec).state)).toBeNull();
    expect(popoverAt(open.update(setWritingIssues([])).state)).toBeNull();
  });

  it("sits where you clicked, so it shows even when its mark starts off screen", () => {
    const tooltipAt = (state: EditorState) => state.facet(showTooltip).find(Boolean)?.pos;
    expect(tooltipAt(click(stateFor("She walked slowly home.\n"), 14))).toBe(14);
    let state = stateFor("She quickly left. The door was closed.\n");
    state = state.update(jumpToMark(state, ["passive"], 1)!).state;
    expect(tooltipAt(state)).toBe(27);
  });

  it("is what the Review panel and ⌥↩ describe after a jump", () => {
    // A hard sentence that starts with a simpler phrase, "In the event that". 18 words, grade 11.
    const text =
      "In the event that the committee approves the long and detailed proposal tomorrow morning, we will build it.";
    let state = stateFor(`${text}\n`);
    state = state.update(jumpToMark(state, ["hard"], 1)!).state;
    expect(shown(state)).toEqual(["hard", text]);
    expect(describeEditor(state).checks).toMatchObject({ here: "Hard to read. 18 words.", fix: null, action: "Suggest rewrites" });
  });

  it("opens on the mark a Review row jumps to", () => {
    let state = stateFor("She quickly left. The door was closed.\n");
    state = state.update(jumpToMark(state, ["passive"], 1)!).state;
    expect(state.selection.main.head).toBe(27);
    expect(shown(state)).toEqual(["passive", "was closed"]);
    expect(jumpToMark(state, ["veryHard"], 1)).toBeNull();
  });
});

describe("the popover at the edges", () => {
  it("stays open at either end of its mark, and on a transaction that changes nothing", () => {
    // "walked slowly" at 4–17.
    const open = click(stateFor("She walked slowly home.\n"), 6);
    expect(shown(caret(open, 4))).toEqual(["weakVerb", "walked slowly"]);
    expect(shown(caret(open, 17))).toEqual(["weakVerb", "walked slowly"]);
    let state = stateFor("She quickly left. The door was closed.\n");
    state = state.update(jumpToMark(state, ["passive"], 1)!).state;
    expect(shown(state.update({}).state)).toEqual(["passive", "was closed"]);
  });

  it("closes when its own kind is hidden, though another mark covers the same words", () => {
    // "really" at 6–12 is an intensifier and an adverb.
    const open = click(stateFor("It is really done.\n"), 8);
    expect(shown(open)).toEqual(["intensifier", "really"]);
    expect(popoverAt(open.update(setHighlights({ hidden: ["intensifier"] })).state)).toBeNull();
  });

  it("shows Claude's writing issue before a live mark on the same words", () => {
    // Claude's issue covers "walked slowly home" at 4–22, longer than the weak verb at 4–17.
    const issue: WritingIssue = { from: 4, to: 22, kind: "grammar", note: "Say “walked home slowly”.", fix: "walked home slowly" };
    const state = stateFor("She walked slowly home.\n").update(setWritingIssues([issue])).state;
    expect(shown(click(state, 6))).toEqual(["grammar", "walked slowly home"]);
  });

  it("uses the fix of the popover's mark from Review's button, wherever the caret is in it", () => {
    // The popover is on "walked slowly" at 4–17; the caret moves onto "slowly", an adverb too.
    const state = caret(click(stateFor("She walked slowly home.\n"), 6), 14);
    expect(describeEditor(state).checks).toMatchObject({
      fix: "strolled",
      fixHint: "Becomes an alternative. ⌥K brings your words back.",
    });
    expect(state.update(useFixAt(state)!).state.doc.toString()).toBe("She strolled home.");
  });

  it("runs ⌥↩ on the popover's mark, and not on a selection", () => {
    // A hard sentence that starts with "Really,", an intensifier and an adverb.
    const text =
      "Really, writers often build long sentences because each new idea wants another clause before the reader can pause.";
    let state = stateFor(`${text}\n`);
    state = state.update(jumpToMark(state, ["hard"], 1)!).state;
    expect(firstAction(state)).toEqual({ rewrite: { from: 0, to: text.length, kind: "hard", phrase: text } });
    const selected = stateFor("She walked slowly home.\n").update({ selection: EditorSelection.range(4, 10) }).state;
    expect(firstAction(selected)).toBeNull();
  });
});

describe("the popover's keys", () => {
  // Runs the binding for `key` the way the editor does.
  const press = (state: EditorState, key: string) => {
    const binding = state.facet(keymap).flat().find((b) => b.key === key && b.run?.toString().length);
    let next = state;
    const view = { state, dispatch: (spec: TransactionSpec | Transaction) => (next = next.update(spec as TransactionSpec).state) };
    const handled = binding!.run!(view as unknown as EditorView);
    return { handled, state: next };
  };
  const handlers = (said: string[]): EditorHandlers =>
    ({ notice: (m: string) => said.push(m), rewrite: (t: { phrase: string }) => said.push(`rewrite ${t.phrase}`) }) as unknown as EditorHandlers;
  const withHandlers = (md: string, said: string[]) => {
    const { text, alts, ghosts, versions } = parsePage(md);
    return createEditorState(text, { alts, ghosts, versions }, () => handlers(said), { on: true, hidden: [] });
  };

  it("⌥↩ uses the suggestion, or asks the app for Claude's rewrite", () => {
    const said: string[] = [];
    const weak = caret(withHandlers("She walked slowly home.\n", said), 6);
    expect(press(weak, "Alt-Enter").state.doc.toString()).toBe("She strolled home.");
    const passive = caret(withHandlers("The door was closed.\n", said), 12);
    expect(press(passive, "Alt-Enter").handled).toBe(true);
    expect(said).toEqual(["rewrite was closed"]);
  });

  it("Esc closes the popover first, and does nothing more", () => {
    const open = click(withHandlers("She walked slowly home.\n", []), 6);
    const after = press(open, "Escape");
    expect(after.handled).toBe(true);
    expect(popoverAt(after.state)).toBeNull();
    expect(press(after.state, "Escape").handled).not.toBe(true);
  });

  it("⌘/ tells the app why it won't ghost part of an alternative", () => {
    const said: string[] = [];
    const state = withHandlers("one {{two words|deux mots}} three\n", said).update({ selection: EditorSelection.range(4, 7) }).state;
    expect(press(state, "Mod-/").handled).toBe(true);
    expect(said).toEqual(["A ghost on part of an alternative isn't saved. Ghost all of it, or none."]);
  });
});

describe("popover actions", () => {
  it("offer a ghost for each kind of word you might cut, and a rewrite for each kind of sentence", () => {
    const first = (md: string, pos: number) => {
      const state = stateFor(md);
      const issue = popoverAt(click(state, pos))!;
      return [issue.kind, actionsFor(state, issue).map((a) => a.kind)];
    };
    expect(first("She left quickly.\n", 11)).toEqual(["adverb", ["ghost", "remove"]]);
    expect(first("It is basically done.\n", 8)).toEqual(["filler", ["ghost", "remove"]]);
    expect(first("It is perhaps done.\n", 8)).toEqual(["qualifier", ["ghost", "remove"]]);
    expect(first("He will be able to swim.\n", 10)).toEqual(["hidden", ["rewrite"]]);
    // 20 words, grade 12: hard. 19 long words, grade 29: very hard.
    expect(
      first("Writers often build long sentences because each new idea wants another clause before the reader can pause or rest here.\n", 3),
    ).toEqual(["hard", ["rewrite"]]);
    expect(
      first(
        "Organizations underestimate how complicated documentation becomes when several departments contribute overlapping requirements without coordinating their terminology or their priorities.\n",
        3,
      ),
    ).toEqual(["veryHard", ["rewrite"]]);
  });

  it("use a suggestion as an alternative that keeps your words", () => {
    let state = stateFor("She walked slowly home.\n");
    const issue = popoverAt(click(state, 6))!;
    expect(actionsFor(state, issue)).toEqual([{ kind: "fix", label: "strolled" }]);
    state = state.update(runAction(state, issue, actionsFor(state, issue)[0])!).state;
    expect(state.doc.toString()).toBe("She strolled home.");
    expect(pageMarkdown(state, "")).toBe("She {{walked slowly|>~strolled}} home.\n");
    expect(undoRedo(state)).toEqual(["She walked slowly home.\n", "She {{walked slowly|>~strolled}} home.\n"]);
    expect(actionHint(issue, { kind: "fix", label: "strolled" })).toBe("Becomes an alternative. ⌥K brings your words back.");
  });

  it("offer a rewrite for a cliché, and the word that says it all for a redundant pair", () => {
    const cliche = stateFor("It moved the needle.\n");
    const issue = popoverAt(click(cliche, 5))!;
    expect(issue).toMatchObject({ kind: "cliche", from: 3, to: 19 });
    expect(actionsFor(cliche, issue)).toEqual([{ kind: "rewrite", label: "Suggest rewrites" }]);
    expect(rewriteRange(cliche, issue)).toEqual({ from: 0, to: 20 });
    expect(popoverContent(cliche, issue)).toMatchObject({
      title: "Cliché",
      text: "Worn smooth by use, it says little. Say what you mean in plain words.",
    });

    let state = stateFor("The end result held.\n");
    const pair = popoverAt(click(state, 6))!;
    expect(popoverContent(state, pair)).toMatchObject({ title: "Redundant pair", text: "One word already says it all." });
    expect(actionsFor(state, pair)).toEqual([{ kind: "fix", label: "result" }]);
    state = state.update(runAction(state, pair, actionsFor(state, pair)[0])!).state;
    expect(state.doc.toString()).toBe("The result held.");
    expect(pageMarkdown(state, "")).toBe("The {{end result|>~result}} held.\n");
    expect(undoRedo(state)).toEqual(["The end result held.\n", "The {{end result|>~result}} held.\n"]);
  });

  it("fix the article before a suggestion, and back again with the original", () => {
    let state = stateFor("It was an initial test.\n");
    const issue = popoverAt(click(state, 12))!;
    expect(issue).toMatchObject({ kind: "simpler", fix: "first" });
    state = state.update(runAction(state, issue, actionsFor(state, issue)[0])!).state;
    expect(state.doc.toString()).toBe("It was a first test.");
    expect(pageMarkdown(state, "")).toBe("It was a {{initial|>~first}} test.\n");
    expect(undoRedo(state)).toEqual(["It was an initial test.\n", "It was a {{initial|>~first}} test.\n"]);
  });

  it("offer to remove a word you might cut, beside ghosting it", () => {
    let state = stateFor("She left quickly.\n");
    const issue = popoverAt(click(state, 12))!;
    expect(actionsFor(state, issue)).toEqual([
      { kind: "ghost", label: "Ghost it" },
      { kind: "remove", label: "Remove it" },
    ]);
    state = state.update(runAction(state, issue, actionsFor(state, issue)[1])!).state;
    expect(pageMarkdown(state, "")).toBe("She left.\n");
    expect(undoRedo(state)).toEqual(["She left quickly.\n", "She left.\n"]);
  });

  it("keep the popover on the ghost after ghosting, to remove or revive it", () => {
    let state = click(stateFor("It is really done.\n"), 8);
    state = state.update(runAction(state, popoverAt(state)!, { kind: "ghost", label: "Ghost it" })!).state;
    const ghost = popoverAt(state)!;
    expect(ghost).toMatchObject({ kind: "ghost", from: 6, to: 12 });
    expect(popoverAt(state.update({}).state)).toMatchObject({ kind: "ghost", from: 6, to: 12 });
    expect(actionsFor(state, ghost)).toEqual([
      { kind: "remove", label: "Remove it" },
      { kind: "revive", label: "Revive it" },
    ]);
    expect(popoverContent(state, ghost)).toMatchObject({ title: "Ghosted", hint: "⌥↩ removes it · esc closes" });
    const removed = state.update(runAction(state, ghost, actionsFor(state, ghost)[0])!).state;
    expect(pageMarkdown(removed, "")).toBe("It is done.\n");
    const revived = state.update(runAction(state, ghost, actionsFor(state, ghost)[1])!).state;
    expect(pageMarkdown(revived, "")).toBe("It is really done.\n");
  });

  it("open on a ghost you click while Review is open, and remove it with ⌥↩", () => {
    // "really" at 6–12 is ghosted, so it isn't marked.
    const state = click(stateFor("It is {-really-} done.\n"), 8);
    expect(shown(state)).toEqual(["ghost", "really"]);
    expect(openPopover(caret(stateFor("It is {-really-} done.\n", false), 8))).toBeNull();
    expect(state.update(firstAction(state)!.spec!).state.doc.toString()).toBe("It is done.");
    // ⌥↩ works with the caret in a ghost, with no popover open.
    const unopened = caret(stateFor("It is {-really-} done.\n"), 8);
    expect(unopened.update(firstAction(unopened)!.spec!).state.doc.toString()).toBe("It is done.");
  });

  it("offer to remove what Claude says to cut", () => {
    // The second "It works." at 10–19.
    const issue: WritingIssue = { from: 10, to: 19, kind: "grammar", note: "Said twice.", fix: "" };
    const state = stateFor("It works. It works.\n").update(setWritingIssues([issue])).state;
    expect(actionsFor(state, issue)).toEqual([{ kind: "remove", label: "Remove it" }]);
    expect(state.update(runAction(state, issue, actionsFor(state, issue)[0])!).state.doc.toString()).toBe("It works.");
  });

  it("ghost a word you might cut", () => {
    // "really" at 6–12 is an intensifier and an adverb; the popover shows the first.
    let state = stateFor("It is really done.\n");
    const issue = popoverAt(click(state, 8))!;
    expect(issue).toMatchObject({ kind: "intensifier", from: 6, to: 12 });
    expect(actionsFor(state, issue)[0]).toEqual({ kind: "ghost", label: "Ghost it" });
    state = state.update(runAction(state, issue, actionsFor(state, issue)[0])!).state;
    expect(state.doc.toString()).toBe("It is really done.");
    expect(pageMarkdown(state, "")).toBe("It is {-really-} done.\n");
    expect(undoRedo(state)).toEqual(["It is really done.\n", "It is {-really-} done.\n"]);
  });

  it("offer a Claude rewrite of the whole sentence for passive voice, after any list marker", () => {
    // "The door was closed by him." at 12–39; "was closed" at 21–31.
    const state = stateFor("- She left. The door was closed by him.\n");
    const issue = popoverAt(click(state, 23))!;
    expect(issue).toMatchObject({ kind: "passive", from: 21, to: 31 });
    expect(actionsFor(state, issue)).toEqual([{ kind: "rewrite", label: "Suggest rewrites" }]);
    expect(popoverContent(state, issue)).toMatchObject({ hint: "⌥↩ suggests rewrites · esc closes" });
    expect(rewriteRange(state, issue)).toEqual({ from: 12, to: 39 });
    // Claude runs from the app, so the action itself changes nothing here.
    expect(runAction(state, issue, actionsFor(state, issue)[0])).toBeNull();

    const first = stateFor("- The door was closed.\n");
    expect(rewriteRange(first, popoverAt(click(first, 12))!)).toEqual({ from: 2, to: 22 });
    // A task item's checkbox stays out of it.
    const task = stateFor("- [ ] The door was closed.\n");
    expect(rewriteRange(task, popoverAt(click(task, 16))!)).toEqual({ from: 6, to: 26 });
    // So does nothing of a bold sentence at the start of a line.
    const bold = stateFor("**The door was closed.**\n");
    expect(rewriteRange(bold, popoverAt(click(bold, 12))!)).toEqual({ from: 0, to: 24 });
  });

  it("add Claude's rewrites to a sentence that is already an alternative", () => {
    // "The door was closed." at 0–20 became an alternative in an earlier rewrite.
    const state = stateFor("{{The door was closed.|Someone closed the door.}}\n");
    const issue = popoverAt(click(state, 12))!;
    expect(actionsFor(state, issue)).toEqual([{ kind: "rewrite", label: "Suggest rewrites" }]);
    expect(rewriteRange(state, issue)).toEqual({ from: 0, to: 20 });
  });

  it("say why when nothing fits", () => {
    const why = (md: string, pos: number) => {
      const state = stateFor(md);
      const issue = popoverAt(click(state, pos))!;
      return [issue.kind, actionsFor(state, issue).length, whyNoAction(state, issue)];
    };
    expect(why("The {-old-} door was closed.\n", 18)).toEqual(["passive", 0, "It has a ghosted word. Revive it with ⌘/ first."]);
    expect(why("The {{door|gate}} was closed.\n", 12)).toEqual(["passive", 0, "Part of it already has alternatives."]);
    expect(why("The `door` was closed.\n", 13)).toEqual(["passive", 0, "It has code in it."]);
    // A sentence that goes on past a line break in its paragraph.
    expect(why("She left. The door was closed by the wind\nthat came in.\n", 21)).toEqual(["passive", 0, "It runs across a line break."]);
    // A list item or a heading on the next line isn't more of the sentence.
    expect(why("- The door was closed by them\n- They left\n", 12)).toEqual(["passive", 1, null]);
    expect(why("The door was closed by them\n# Next\n", 10)).toEqual(["passive", 1, null]);
    // Bold that starts in one sentence and ends in the next.
    expect(why("**She left. The door was closed.**\n", 23)).toEqual(["passive", 0, "It cuts through bold or italic text."]);
    expect(why("She {{walked slowly|ran}} home.\n", 6)).toEqual(["weakVerb", 0, "It's an alternative already. ⌥J and ⌥K switch its versions."]);
    expect(why("She {{walked|ran}} slowly home.\n", 6)).toEqual(["weakVerb", 0, "Part of it already has alternatives."]);
    // "Remove it" still fits there; ghosting doesn't, and the reason says why.
    expect(why("{{It is really done.|It is done.}}\n", 8)).toEqual([
      "intensifier",
      1,
      "It's inside an alternative, where a ghost isn't saved. Select the whole alternative and press ⌘/.",
    ]);
    expect(why("She walked slowly home.\n", 6)).toEqual(["weakVerb", 1, null]);
  });

  it("count a hard sentence's words as Review does, without link addresses", () => {
    // 17 words, 89 letters: 4.71 × 89/17 + 0.5 × 17 − 21.43 = 11.73, grade 12, hard.
    const md =
      "Writers often build long sentences because each new idea wants another clause before the [reader](https://example.com/x/y/z) can pause.\n";
    const state = stateFor(md);
    const issue = popoverAt(click(state, 3))!;
    expect(issue.kind).toBe("hard");
    expect(popoverContent(state, issue)).toMatchObject({
      title: "Hard to read",
      text: "17 words. Split it, or use shorter words.",
    });
  });

  it("ghost a word that is a whole alternative, which saves", () => {
    let state = stateFor("It is {{really|truly}} done.\n");
    const issue = popoverAt(click(state, 8))!;
    expect(actionsFor(state, issue).map((a) => a.kind)).toEqual(["ghost", "remove"]);
    state = state.update(runAction(state, issue, actionsFor(state, issue)[0])!).state;
    const saved = pageMarkdown(state, "");
    expect(saved).toBe("It is {-{{really|truly}}-} done.\n");
    expect(parsePage(saved).ghosts).toEqual([{ from: 6, to: 12 }]);
  });

  it("offer Claude's fix for a writing issue", () => {
    const issue: WritingIssue = { from: 4, to: 7, kind: "grammar", note: "Spelling.", fix: "the" };
    const state = stateFor("Fix teh now.\n").update(setWritingIssues([issue])).state;
    expect(actionsFor(state, issue)).toEqual([{ kind: "fix", label: "the" }]);
  });

  it("replace a writing issue's words with its fix, and leave the next issue marked", () => {
    // "Its" at 0–3, "loose" at 12–17.
    const its: WritingIssue = { from: 0, to: 3, kind: "grammar", note: "Contraction of “it is” needs an apostrophe.", fix: "It's" };
    const loose: WritingIssue = { from: 12, to: 17, kind: "grammar", note: "Wrong word: “lose” intended.", fix: "lose" };
    let state = stateFor("Its easy to loose track.\n").update(setWritingIssues([its, loose])).state;
    const issue = popoverAt(click(state, 1))!;
    expect(issue).toMatchObject({ kind: "grammar", fix: "It's" });
    const action = actionsFor(state, issue)[0];
    expect(action).toEqual({ kind: "fix", label: "It's" });
    expect(actionHint(issue, action)).toBe("Replaces it. ⌘Z brings it back.");
    state = state.update(runAction(state, issue, action)!).state;
    expect(state.doc.toString()).toBe("It's easy to loose track.");
    expect(pageMarkdown(state, "")).toBe("It's easy to loose track.\n");
    expect(writingIssues(state)).toEqual([{ ...loose, from: 13, to: 18 }]);
    expect(undoRedo(state)).toEqual(["Its easy to loose track.\n", "It's easy to loose track.\n"]);
  });

  it("offer nothing that would save a different page", () => {
    // A suggestion over an alternative, and a rewrite of a sentence with code in it.
    const alt = stateFor("She {{walked slowly|ran}} home.\n");
    expect(actionsFor(alt, popoverAt(click(alt, 6))!)).toEqual([]);
    const code = stateFor("The `door` was closed.\n");
    const passive = popoverAt(click(code, 13))!;
    expect(passive).toMatchObject({ kind: "passive" });
    expect(rewriteRange(code, passive)).toBeNull();
    expect(actionsFor(code, passive)).toEqual([]);
  });

  it("run the first action at the caret with ⌥↩, popover or not", () => {
    const weak = caret(stateFor("She walked slowly home.\n"), 6);
    const fix = firstAction(weak)!;
    expect(weak.update(fix.spec!).state.doc.toString()).toBe("She strolled home.");
    const passive = caret(stateFor("The door was closed.\n"), 12);
    expect(firstAction(passive)).toEqual({ rewrite: { from: 0, to: 20, kind: "passive", phrase: "was closed" } });
    expect(firstAction(caret(stateFor("Plain words here.\n"), 3))).toBeNull();
  });
});

describe("the popover on a misspelled word", () => {
  // "recieve" at 3–10.
  const PAGE = "We recieve it.";
  const marked = (on = false, md = `${PAGE}\n`, text = PAGE, words: [number, number][] = [[3, 10]]) =>
    stateFor(md, on).update(spellingChecked([{ text, checked: { language: "en", words } }])).state;
  const guessed = (state: EditorState, word = "recieve", guesses = ["receive", "relieve", "deceive", "reprieve", "recite"]) =>
    state.update(setGuesses(word, guesses)).state;
  const LEARN: PopoverAction = { kind: "learn", label: "Learn spelling" };

  it("opens with Review closed, and offers the best guesses once they come, and Learn", () => {
    let state = click(marked(), 5);
    expect(shown(state)).toEqual(["spelling", "recieve"]);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Spelling",
      text: "Not in the dictionary. Finding suggestions…",
      why: null,
      actions: [LEARN],
      hint: "esc closes",
    });
    const before = state.facet(showTooltip)[0];
    state = guessed(state);
    // The popover shows again, with the guesses.
    expect(state.facet(showTooltip)[0]).not.toBe(before);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Spelling",
      text: "Not in the dictionary.",
      why: null,
      actions: [
        { kind: "spell", label: "receive" },
        { kind: "spell", label: "relieve" },
        { kind: "spell", label: "deceive" },
        { kind: "spell", label: "reprieve" },
        LEARN,
      ],
      hint: "⌥↩ uses it · esc closes",
    });
    state = guessed(state, "recieve", []);
    expect(popoverContent(state, popoverAt(state)!)).toMatchObject({ text: "Not in the dictionary. No suggestions.", actions: [LEARN] });
  });

  it("puts a guess in place of the word, ⌥↩ the best one, and undo brings the word back", () => {
    const state = guessed(click(marked(), 5));
    const picked = state.update(runAction(state, popoverAt(state)!, { kind: "spell", label: "relieve" })!).state;
    expect(pageMarkdown(picked, "")).toBe("We relieve it.\n");
    expect(popoverAt(picked)).toBeNull();
    const best = state.update(firstAction(state)!.spec!).state;
    expect(pageMarkdown(best, "")).toBe("We receive it.\n");
    expect(undoRedo(best)).toEqual(["We recieve it.\n", "We receive it.\n"]);
  });

  it("never learns a word with ⌥↩, even before the guesses come", () => {
    expect(firstAction(click(marked(), 5))).toBeNull();
  });

  it("learns the word: the mark and the popover go", () => {
    let state = guessed(click(marked(), 5));
    state = state.update(runAction(state, popoverAt(state)!, LEARN)!).state;
    expect(misspellings(state)).toEqual([]);
    expect(popoverAt(state)).toBeNull();
    expect(pageMarkdown(state, "")).toBe("We recieve it.\n");
  });

  it("comes before a Review mark around the word, and stays out of Review's panel", () => {
    const issue: WritingIssue = { from: 3, to: 13, kind: "grammar", note: "Wrong word.", fix: "get it" };
    const state = click(marked(true).update(setWritingIssues([issue])).state, 5);
    expect(shown(state)).toEqual(["spelling", "recieve"]);
    expect(describeEditor(state).checks).toMatchObject({ here: null, fix: null, action: null });
  });

  it("offers no guess where an alternative cuts through the word, and says why", () => {
    // The alternative is "big" or "larg"; "large" ends past it, at 2–7.
    const state = guessed(click(marked(false, "A {{big|>larg}}e dog.\n", "A large dog.", [[2, 7]]), 3), "large", ["larger"]);
    expect(shown(state)).toEqual(["spelling", "large"]);
    expect(actionsFor(state, popoverAt(state)!)).toEqual([LEARN]);
    expect(whyNoAction(state, popoverAt(state)!)).toBe("An alternative or a ghost cuts through it.");
  });
});

describe("the popover on a punctuation mistake", () => {
  const FIX: PopoverAction = { kind: "fix", label: "said," };

  it("opens with Review closed, says what's wrong, and uses the fix", () => {
    const state = click(stateFor("He said , then left.\n", false), 5);
    expect(shown(state)).toEqual(["punctuation", "said ,"]);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Punctuation",
      text: "A space before the comma.",
      why: null,
      actions: [FIX],
      hint: "⌥↩ uses it · esc closes",
    });
    expect(actionHint(popoverAt(state)!, FIX)).toBe("Replaces it. ⌘Z brings it back.");
    const fixed = state.update(firstAction(state)!.spec!).state;
    expect(pageMarkdown(fixed, "")).toBe("He said, then left.\n");
    expect(popoverAt(fixed)).toBeNull();
    expect(undoRedo(fixed)).toEqual(["He said , then left.\n", "He said, then left.\n"]);
    const used = state.update(useFixAt(state)!).state;
    expect(pageMarkdown(used, "")).toBe("He said, then left.\n");
  });

  it("says what's missing where there is no fix", () => {
    const state = click(stateFor("We left (in a hurry.\n", false), 9);
    expect(shown(state)).toEqual(["punctuation", "(in"]);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Punctuation",
      text: "No closing parenthesis.",
      why: null,
      actions: [],
      hint: null,
    });
    expect(firstAction(state)).toBeNull();
  });

  it("says why the fix can't go, as over an alternative", () => {
    const state = click(stateFor("He {{said ,|told}} it.\n", false), 4);
    expect(shown(state)).toEqual(["punctuation", "said ,"]);
    expect(actionsFor(state, popoverAt(state)!)).toEqual([]);
    expect(whyNoAction(state, popoverAt(state)!)).toBe("Part of it already has alternatives.");
  });

  it("stays open while the caret moves inside its mark", () => {
    let state = click(stateFor("He said , then left.\n", false), 5);
    state = caret(state, 8);
    expect(shown(state)).toEqual(["punctuation", "said ,"]);
    expect(shown(caret(state, 12))).toBeNull();
  });

  it("comes after a misspelled word on the same words", () => {
    const page = "We recieve , today.";
    const state = stateFor(`${page}\n`, false).update(spellingChecked([{ text: page, checked: { language: "en", words: [[3, 10]] } }])).state;
    expect(shown(click(state, 5))).toEqual(["spelling", "recieve"]);
    expect(shown(click(state, 11))).toEqual(["punctuation", "recieve ,"]);
  });

  it("lets a Review word mark or a writing issue on its words come first, and stays out of Review's panel", () => {
    // "basically" at 3–12 is filler; "basically ," at 3–14 has a space before the comma.
    let state = stateFor("He basically , left.\n", true);
    expect(shown(click(state, 5))).toEqual(["filler", "basically"]);
    state = caret(state, 5);
    expect(describeEditor(state).checks).toMatchObject({ here: "Filler. It adds words, not meaning.", action: "Ghost it" });
    expect(pageMarkdown(state.update(firstAction(state)!.spec!).state, "")).toBe("He {-basically-} , left.\n");
    // On the comma, the punctuation mark: the panel says nothing, and ⌥↩ uses its fix.
    state = caret(state, 13);
    expect(describeEditor(state).checks).toMatchObject({ here: null, fix: null, action: null });
    expect(pageMarkdown(state.update(firstAction(state)!.spec!).state, "")).toBe("He basically, left.\n");
    expect(shown(click(state, 13))).toEqual(["punctuation", "basically ,"]);

    const issue: WritingIssue = { from: 3, to: 14, kind: "grammar", note: "Cut it.", fix: "then," };
    expect(shown(click(state.update(setWritingIssues([issue])).state, 13))).toEqual(["grammar", "basically ,"]);
  });

  it("comes before a sentence mark around it", () => {
    // 21 words, very hard to read.
    const page = "The committee reviewed the proposal , discussed the budget, weighed the risks, and approved the plan before the deadline passed last week.";
    const state = click(stateFor(`${page}\n`, true), 37);
    expect(describeEditor(state).checks?.counts).toMatchObject({ hard: 0, veryHard: 1 });
    expect(shown(state)).toEqual(["punctuation", "proposal ,"]);
    // With the popover closed, the panel says nothing, as ⌥↩ fixes the comma.
    const closed = caret(state.update(closePopover).state, 37);
    expect(popoverAt(closed)).toBeNull();
    expect(describeEditor(closed).checks).toMatchObject({ here: null, fix: null, action: null });
    expect(closed.update(firstAction(closed)!.spec!).state.doc.toString()).toBe(page.replace("proposal ,", "proposal,"));
  });
});

describe("the popover on a dash", () => {
  it("offers rewrites without the dash, for a dash too many", () => {
    // "— very late." at 37–49 is the paragraph's second use.
    // A click on "late", as "very" is an intensifier, the shorter mark.
    const state = click(stateFor("My plan — bold — failed. It was late — very late.\n"), 46);
    expect(shown(state)).toEqual(["dash", "— very late."]);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Dash",
      text: "One dash, or one pair, per paragraph reads well. Try a comma, a colon, parentheses, or a period.",
      why: null,
      actions: [{ kind: "rewrite", label: "Suggest rewrites" }],
      hint: "⌥↩ suggests rewrites · esc closes",
    });
    expect(rewriteRange(state, popoverAt(state)!)).toEqual({ from: 25, to: 49 });
    expect(firstAction(state)).toEqual({ rewrite: { from: 25, to: 49, kind: "dash", phrase: "— very late." } });
  });

  it("comes after a punctuation mistake in its words, as a mark to the sentence's end", () => {
    const state = click(stateFor("It was late — very late. We left — fast , then.\n"), 40);
    expect(shown(state)).toEqual(["punctuation", "fast ,"]);
  });

  it("uses the page's style for a dash in another, as an alternative", () => {
    const md = "One — two.\n\nThree — four.\n\nFive—six.\n";
    const state = click(stateFor(md), 33);
    expect(shown(state)).toEqual(["dashStyle", "Five—six."]);
    expect(popoverContent(state, popoverAt(state)!)).toEqual({
      title: "Dash style",
      text: "Write the page's dashes one way.",
      why: null,
      actions: [{ kind: "fix", label: "Five — six." }],
      hint: "⌥↩ uses it · esc closes",
    });
    const fixed = state.update(firstAction(state)!.spec!).state;
    const saved = "One — two.\n\nThree — four.\n\n{{Five—six.|>~Five — six.}}\n";
    expect(pageMarkdown(fixed, "")).toBe(saved);
    expect(undoRedo(fixed)).toEqual([md, saved]);
  });
});
