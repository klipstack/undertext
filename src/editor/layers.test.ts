import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  addAiAlternatives,
  addAltVariant,
  countWords,
  createAlt,
  cycleAlt,
  cycleAtCaret,
  cycleVersion,
  deleteGhosts,
  dropAlt,
  forkVersion,
  jumpToItem,
  removeAltVariant,
  removeVersionVariant,
  reviveAll,
  reviveAt,
  setAltActive,
  settleAll,
  settleVersion,
  setVersionActive,
  ghostBlocked,
  ghostRange,
  removeSpan,
  toggleGhost,
  versionedItems,
} from "./commands";
import { insertMarkdown } from "./clipboard";
import { parsePage, serializePage } from "./format";
import { createEditorState, ghostOrKeep } from "./setup";
import { layers, layersOf } from "./layers";

const stateFor = (md: string) => {
  const page = parsePage(md);
  return EditorState.create({ doc: page.text, extensions: [history(), layers(page)] });
};

const save = (state: EditorState) => serializePage({ text: state.doc.toString(), ...layersOf(state), overflow: "" });
const apply = (state: EditorState, spec: TransactionSpec | null) => {
  expect(spec).not.toBeNull();
  return state.update(spec!).state;
};
const run = (state: EditorState, cmd: typeof undo) => {
  let next = state;
  cmd({ state, dispatch: (tr) => (next = tr.state) });
  return next;
};
const at = (state: EditorState, needle: string) => state.doc.toString().indexOf(needle);
const select = (state: EditorState, from: number, to = from) =>
  state.update({ selection: EditorSelection.range(from, to) }).state;
const altIdAt = (state: EditorState, needle: string) =>
  layersOf(state).alts.find((a) => a.from <= at(state, needle) && at(state, needle) < a.to)!.id;

describe("alternatives", () => {
  it("creates, adds, cycles, and removes", () => {
    let state = stateFor("Much of the tension comes from here.\n");
    const created = createAlt(state, at(state, "tension"), at(state, "tension") + 7)!;
    state = apply(state, created.spec);
    state = apply(state, addAltVariant(state, created.id, "pressure"));
    expect(state.doc.toString()).toBe("Much of the pressure comes from here.");
    state = apply(state, cycleAlt(state, created.id, 1));
    expect(state.doc.toString()).toBe("Much of the tension comes from here.");
    expect(save(state)).toBe("Much of the {{tension|pressure}} comes from here.\n");
    state = apply(state, removeAltVariant(state, created.id, 1));
    expect(save(state)).toBe("Much of the tension comes from here.\n");
  });

  it("keeps the active variant when one before it is removed", () => {
    let state = stateFor("the {{tension|>pressure|strain}} here\n");
    state = apply(state, removeAltVariant(state, altIdAt(state, "pressure"), 0));
    expect(state.doc.toString()).toBe("the pressure here");
    expect(save(state)).toBe("the {{pressure|strain}} here\n");
  });

  it("keeps in-place edits of the active variant", () => {
    let state = stateFor("the {{tension|>struggle}} here\n");
    const id = altIdAt(state, "struggle");
    const pos = at(state, "struggle") + "struggle".length - 1;
    state = state.update({ changes: { from: pos, insert: "s" } }).state;
    expect(save(state)).toBe("the {{tension|>strugglse}} here\n");
    state = apply(state, cycleAlt(state, id, 1));
    expect(state.doc.toString()).toBe("the tension here");
    expect(save(state)).toBe("the {{tension|strugglse}} here\n");
    state = apply(state, cycleAlt(state, id, 1));
    expect(state.doc.toString()).toBe("the strugglse here");
    expect(save(state)).toBe("the {{tension|>strugglse}} here\n");
  });

  it("cycles backward and forward through three variants, wrapping", () => {
    let state = stateFor("the {{tension|>pressure|strain}} here\n");
    const id = altIdAt(state, "pressure");
    state = apply(state, cycleAlt(state, id, -1));
    expect(state.doc.toString()).toBe("the tension here");
    expect(save(state)).toBe("the {{tension|pressure|strain}} here\n");
    state = apply(state, cycleAlt(state, id, -1));
    expect(state.doc.toString()).toBe("the strain here");
    expect(save(state)).toBe("the {{tension|pressure|>strain}} here\n");
    state = apply(state, cycleAlt(state, id, -1));
    expect(state.doc.toString()).toBe("the pressure here");
    expect(save(state)).toBe("the {{tension|>pressure|strain}} here\n");
    state = apply(state, cycleAlt(state, id, 1));
    expect(state.doc.toString()).toBe("the strain here");
    expect(save(state)).toBe("the {{tension|pressure|>strain}} here\n");
  });

  it("takes letters typed at its end, but not a space or text at its start", () => {
    let state = stateFor("an {{elephant|owl}} here\n");
    const alt = () => layersOf(state).alts[0];
    const type = (pos: number, text: string) =>
      (state = state.update({ changes: { from: pos, insert: text }, userEvent: "input.type" }).state);
    type(alt().to, "s");
    expect(save(state)).toBe("an {{elephants|owl}} here\n");
    type(alt().to, " ");
    type(alt().to + 1, "big");
    type(alt().from, "x");
    expect(save(state)).toBe("an x{{elephants|owl}} big here\n");
  });

  it("doesn't grow when a change lands at its edges", () => {
    let state = stateFor("a {{b|c}} d\n");
    const alt = layersOf(state).alts[0];
    state = state.update({ changes: [{ from: alt.from, insert: "x" }, { from: alt.to, insert: "y" }] }).state;
    expect(save(state)).toBe("a x{{b|c}}y d\n");
  });

  it("fixes a/an", () => {
    let state = stateFor("like a {{paperclip|eraser|thumbtack}} for example\n");
    const id = altIdAt(state, "paperclip");
    state = apply(state, cycleAlt(state, id, 1));
    expect(state.doc.toString()).toBe("like an eraser for example");
    state = apply(state, cycleAlt(state, id, 1));
    expect(state.doc.toString()).toBe("like a thumbtack for example");
  });

  it("gives each part of a split alternative its own id", () => {
    let state = stateFor("say {{hello world|hi}} now\n");
    state = state.update({ changes: { from: at(state, " world"), to: at(state, " world") + 1, insert: "\n" } }).state;
    const ids = layersOf(state).alts.map((a) => a.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("undo", () => {
  it("undoes and redoes a cycle", () => {
    let state = stateFor("the {{tension|pressure}} here\n");
    const id = altIdAt(state, "tension");
    state = apply(state, cycleAlt(state, id, 1));
    expect(save(state)).toBe("the {{tension|>pressure}} here\n");
    state = run(state, undo);
    expect(save(state)).toBe("the {{tension|pressure}} here\n");
    state = run(state, redo);
    expect(save(state)).toBe("the {{tension|>pressure}} here\n");
  });

  it("brings back an alternative whose text was deleted", () => {
    let state = stateFor("one {{two|deux}} three\n");
    state = state.update({ changes: { from: 0, to: state.doc.length } }).state;
    expect(layersOf(state).alts).toEqual([]);
    state = run(state, undo);
    expect(save(state)).toBe("one {{two|deux}} three\n");
  });

  it("restores an alternative after typing over its end", () => {
    let state = stateFor("one {{two|deux}} three\n");
    const end = at(state, " three");
    state = state.update({ changes: { from: end - 2, to: end + 3, insert: "X" } }).state;
    state = run(state, undo);
    expect(save(state)).toBe("one {{two|deux}} three\n");
  });

  it("won't ghost part of an alternative, which a save would lose, and says why", () => {
    // "two words" at 4–13 is an alternative.
    const base = stateFor("one {{two words|deux mots}} three\n");
    const part = select(base, 4, 7);
    expect(ghostBlocked(part)).toBe("A ghost on part of an alternative isn't saved. Ghost all of it, or none.");
    expect(layersOf(run(part, toggleGhost)).ghosts).toEqual([]);
    const whole = select(base, 0, 13);
    expect(ghostBlocked(whole)).toBeNull();
    expect(save(run(whole, toggleGhost))).toBe("{-one {{two words|deux mots}}-} three\n");

    // ⌘/ says why, and changes nothing.
    const said: string[] = [];
    let state = part;
    const handled = ghostOrKeep((m) => said.push(m))({ state, dispatch: (tr) => (state = tr.state) });
    expect(handled).toBe(true);
    expect(said).toEqual(["A ghost on part of an alternative isn't saved. Ghost all of it, or none."]);
    expect(layersOf(state).ghosts).toEqual([]);
  });

  it("won't revive part of a ghost when the rest would sit on part of an alternative", () => {
    // "one two words" at 0–13 is ghosted; "two words" at 4–13 is an alternative inside it.
    const base = stateFor("{-one {{two words|deux mots}}-} three\n");
    const part = select(base, 0, 7);
    expect(ghostBlocked(part)).toBe("A ghost on part of an alternative isn't saved. Revive all of it, or none.");
    expect(layersOf(run(part, toggleGhost)).ghosts).toEqual([{ from: 0, to: 13 }]);
    const whole = select(base, 4, 13);
    expect(ghostBlocked(whole)).toBeNull();
    expect(save(run(whole, toggleGhost))).toBe("{-one -}{{two words|deux mots}} three\n");
  });

  it("drops a pasted ghost that would sit on part of an alternative", () => {
    // Pasting "{-new-}" into "two words", the alternative at 4–13.
    const state = stateFor("one {{two words|deux mots}} three\n");
    const next = state.update(insertMarkdown(state, 8, 8, "{-new-} ")).state;
    expect(next.doc.toString()).toBe("one two new words three");
    expect(layersOf(next).ghosts).toEqual([]);
    // Outside an alternative it stays.
    const out = state.update(insertMarkdown(state, 0, 0, "{-new-} ")).state;
    expect(layersOf(out).ghosts).toEqual([{ from: 0, to: 3 }]);
    // An alternative can't hold another, so a pasted one inside keeps only its words.
    const nested = state.update(insertMarkdown(state, 8, 8, "{{a|b}}")).state;
    expect(nested.doc.toString()).toBe("one two awords three");
    expect(layersOf(nested).alts.map((a) => [a.from, a.to])).toEqual([[4, 14]]);
  });

  it("won't ghost code, which a save would write as text", () => {
    // "all" at 10–13 is inside the code span. Telling code needs the editor's Markdown parser.
    const page = parsePage("Run `make all now` here.\n");
    const state = select(createEditorState(page.text, page), 10, 13);
    expect(ghostBlocked(state)).toBe("Code can't be ghosted: a save would write the ghost into the code.");
    expect(layersOf(run(state, toggleGhost)).ghosts).toEqual([]);
  });

  it("removes words and tidies the spaces, commas, and capital around them", () => {
    const remove = (text: string, word: string) => {
      const state = stateFor(`${text}\n`);
      const from = at(state, word);
      return state.update(removeSpan(state, { from, to: from + word.length })).state.doc.toString();
    };
    expect(remove("She left quickly.", "quickly")).toBe("She left.");
    expect(remove("It is really done.", "really")).toBe("It is done.");
    expect(remove("Basically, it is done.", "Basically")).toBe("It is done.");
    expect(remove("It is, basically, done.", "basically")).toBe("It is done.");
    expect(remove("Done. Perhaps we left.", "Perhaps")).toBe("Done. We left.");
    expect(remove("Really", "Really")).toBe("");
  });

  it("undoes and redoes a ghost toggle", () => {
    let state = select(stateFor("one two three\n"), 4, 7);
    state = run(state, toggleGhost);
    expect(save(state)).toBe("one {-two-} three\n");
    state = run(state, undo);
    expect(save(state)).toBe("one two three\n");
    state = run(state, redo);
    expect(save(state)).toBe("one {-two-} three\n");
  });

  // cycleAlt and setVersionActive have their own undo tests. createAlt and cleanupSingleAlts
  // are not here: they add or drop a one-variant alternative, which saves as plain text.
  it.each<{ name: string; md: string; cmd: (state: EditorState) => TransactionSpec | null; after: string }>([
    {
      name: "setAltActive",
      md: "the {{tension|pressure|strain}} here\n",
      cmd: (s) => setAltActive(s, altIdAt(s, "tension"), 2),
      after: "the {{tension|pressure|>strain}} here\n",
    },
    {
      name: "addAltVariant",
      md: "the {{tension|pressure}} here\n",
      cmd: (s) => addAltVariant(s, altIdAt(s, "tension"), "strain"),
      after: "the {{tension|pressure|>strain}} here\n",
    },
    {
      name: "addAiAlternatives",
      md: "the {{tension|pressure}} here\n",
      cmd: (s) => addAiAlternatives(s, altIdAt(s, "tension"), ["strain"]),
      after: "the {{tension|pressure|~strain}} here\n",
    },
    {
      name: "removeAltVariant",
      md: "the {{tension|>pressure|strain}} here\n",
      cmd: (s) => removeAltVariant(s, altIdAt(s, "pressure"), 1),
      after: "the {{tension|strain}} here\n",
    },
    {
      name: "dropAlt",
      md: "the {{tension|>pressure}} here\n",
      cmd: (s) => dropAlt(s, altIdAt(s, "pressure")),
      after: "the pressure here\n",
    },
    {
      name: "cycleVersion",
      md: ":::alt*\nOne.\n:::or\nTwo.\n:::\n",
      cmd: (s) => cycleVersion(s, 0, 1),
      after: ":::alt\nOne.\n:::or*\nTwo.\n:::\n",
    },
    {
      name: "forkVersion",
      md: "Original paragraph.\n",
      cmd: (s) => forkVersion(s, 0),
      after: ":::alt\nOriginal paragraph.\n:::or*\nOriginal paragraph.\n:::\n",
    },
    {
      name: "removeVersionVariant",
      md: ":::alt\nOne.\n:::or*\nTwo.\n:::or\nThree.\n:::\n",
      cmd: (s) => removeVersionVariant(s, 0, 1),
      after: ":::alt*\nOne.\n:::or\nThree.\n:::\n",
    },
    {
      name: "settleVersion",
      md: ":::alt\nOne.\n:::or*\nTwo.\n:::\n",
      cmd: (s) => settleVersion(s, 0),
      after: "Two.\n",
    },
    {
      name: "settleAll",
      md: "A {{one|>uno}} word. {-gone-}\n\n:::alt\nFirst.\n:::or*\nSecond.\n:::\n",
      cmd: (s) => settleAll(s),
      after: "A uno word. {-gone-}\n\nSecond.\n",
    },
    {
      name: "ghostRange",
      md: "one two three\n",
      cmd: (s) => ghostRange(s, at(s, "two"), at(s, "two") + 3),
      after: "one {-two-} three\n",
    },
    {
      name: "reviveAt",
      md: "one {-two-} three\n",
      cmd: (s) => reviveAt(s, at(s, "two")),
      after: "one two three\n",
    },
    {
      name: "reviveAll",
      md: "one {-two-} three {-four-}\n",
      cmd: (s) => reviveAll(s),
      after: "one two three four\n",
    },
    {
      name: "deleteGhosts",
      md: "Keep this. {-Maybe cut.-} Keep that.\n",
      cmd: (s) => deleteGhosts(s),
      after: "Keep this. Keep that.\n",
    },
  ])("undoes and redoes $name", ({ md, cmd, after }) => {
    let state = stateFor(md);
    expect(save(state)).toBe(md);
    state = apply(state, cmd(state));
    expect(save(state)).toBe(after);
    state = run(state, undo);
    expect(save(state)).toBe(md);
    state = run(state, redo);
    expect(save(state)).toBe(after);
  });

  it("undoes a swap on its own, not with the typing next to it", () => {
    let state = stateFor("the {{tension|pressure}}\n");
    const id = altIdAt(state, "tension");
    state = state.update({ changes: { from: state.doc.length, insert: " here" }, userEvent: "input.type" }).state;
    expect(save(state)).toBe("the {{tension|pressure}} here\n");
    state = apply(state, cycleAlt(state, id, 1));
    expect(save(state)).toBe("the {{tension|>pressure}} here\n");
    state = run(state, undo);
    expect(save(state)).toBe("the {{tension|pressure}} here\n");
    state = run(state, undo);
    expect(save(state)).toBe("the {{tension|pressure}}\n");
  });

  it("undoes typing far from any layer without touching the layers", () => {
    let state = stateFor("{{a|b}} and some words\n");
    state = state.update({ changes: { from: state.doc.length, insert: " more" } }).state;
    state = run(state, undo);
    expect(save(state)).toBe("{{a|b}} and some words\n");
  });
});

describe("paragraph versions", () => {
  it("forks, edits in place, and switches", () => {
    let state = stateFor("Original paragraph.\n");
    state = apply(state, forkVersion(state, 0));
    state = state.update({ changes: { from: state.doc.length, insert: " Edited." } }).state;
    expect(save(state)).toBe(":::alt\nOriginal paragraph.\n:::or*\nOriginal paragraph. Edited.\n:::\n");
    state = apply(state, setVersionActive(state, 0, 0));
    expect(state.doc.toString()).toBe("Original paragraph.");
    expect(save(state)).toBe(":::alt*\nOriginal paragraph.\n:::or\nOriginal paragraph. Edited.\n:::\n");
    state = run(state, undo);
    expect(state.doc.toString()).toBe("Original paragraph. Edited.");
    expect(save(state)).toBe(":::alt\nOriginal paragraph.\n:::or*\nOriginal paragraph. Edited.\n:::\n");
    state = run(state, redo);
    expect(save(state)).toBe(":::alt*\nOriginal paragraph.\n:::or\nOriginal paragraph. Edited.\n:::\n");
  });

  it("brings in the layers of the version it switches to", () => {
    let state = stateFor("Intro.\n\n:::alt\nOld {-faint-}.\n:::or*\nNew {{word|term}}.\n:::\n");
    state = apply(state, setVersionActive(state, 8, 0));
    expect(state.doc.toString()).toBe("Intro.\n\nOld faint.");
    expect(layersOf(state).ghosts).toEqual([{ from: 12, to: 17 }]);
    expect(save(state)).toBe("Intro.\n\n:::alt*\nOld {-faint-}.\n:::or\nNew {{word|term}}.\n:::\n");
  });

  it("drops a version when its paragraph joins the one above", () => {
    let state = stateFor("Above.\n\n:::alt\nA.\n:::or\nB.\n:::\n");
    state = state.update({ changes: { from: 6, to: 8 } }).state;
    expect(layersOf(state).versions).toEqual([]);
    expect(save(state)).toBe("Above.A.\n");
    state = run(state, undo);
    expect(layersOf(state).versions).toHaveLength(1);
    expect(save(state)).toBe("Above.\n\n:::alt*\nA.\n:::or\nB.\n:::\n");
  });

  it("cycles backward and forward through three versions, wrapping", () => {
    let state = stateFor(":::alt\nOne.\n:::or*\nTwo.\n:::or\nThree.\n:::\n");
    state = apply(state, cycleVersion(state, 0, -1));
    expect(state.doc.toString()).toBe("One.");
    expect(save(state)).toBe(":::alt*\nOne.\n:::or\nTwo.\n:::or\nThree.\n:::\n");
    state = apply(state, cycleVersion(state, 0, -1));
    expect(state.doc.toString()).toBe("Three.");
    expect(save(state)).toBe(":::alt\nOne.\n:::or\nTwo.\n:::or*\nThree.\n:::\n");
    state = apply(state, cycleVersion(state, 0, -1));
    expect(state.doc.toString()).toBe("Two.");
    expect(save(state)).toBe(":::alt\nOne.\n:::or*\nTwo.\n:::or\nThree.\n:::\n");
    state = apply(state, cycleVersion(state, 0, 1));
    expect(state.doc.toString()).toBe("Three.");
    expect(save(state)).toBe(":::alt\nOne.\n:::or\nTwo.\n:::or*\nThree.\n:::\n");
  });

  it("keeps the active version when one before it is removed", () => {
    let state = stateFor(":::alt\nOne.\n:::or*\nTwo.\n:::or\nThree.\n:::\n");
    state = apply(state, removeVersionVariant(state, 0, 0));
    expect(state.doc.toString()).toBe("Two.");
    expect(save(state)).toBe(":::alt*\nTwo.\n:::or\nThree.\n:::\n");
  });
});

describe("keyboard navigation", () => {
  const md = "Start {{one|uno}} here.\n\nPlain paragraph.\n\n:::alt\n{{two|dos}} and more.\n:::or\nOther version.\n:::\n";

  it("lists items in order, paragraph before its words", () => {
    expect(versionedItems(stateFor(md)).map((i) => i.kind)).toEqual(["alt", "para", "alt"]);
  });

  it("jumps forward and back with wrap-around", () => {
    let state = stateFor(md);
    // "one" starts at 6. The last paragraph and its first word, "two", both start at 35.
    expect(state.doc.toString()).toBe("Start one here.\n\nPlain paragraph.\n\ntwo and more.");
    let last: number | null = null;
    const jump = (dir: 1 | -1) => {
      const r = jumpToItem(state, dir, last)!;
      state = apply(state, r.spec);
      last = r.index;
      return [state.selection.main.head, r.index];
    };
    expect(jump(1)).toEqual([6, 0]);
    expect(jump(1)).toEqual([35, 1]);
    expect(jump(1)).toEqual([35, 2]);
    expect(jump(1)).toEqual([6, 0]);
    expect(jump(-1)).toEqual([35, 2]);
  });

  it("jumps back from the caret with no last jump", () => {
    // The palette's "Previous" passes no last jump. "one" starts at 6, "Plain" at 17, and the last
    // paragraph and "two" at 35. From an item's start, it goes to the one before, not the same one.
    const back = (pos: number) => {
      const state = select(stateFor(md), pos);
      const r = jumpToItem(state, -1, null)!;
      return [apply(state, r.spec).selection.main.head, r.index];
    };
    expect(back(17)).toEqual([6, 0]);
    expect(back(6)).toEqual([35, 2]);
    expect(back(0)).toEqual([35, 2]);
  });

  it("cycles the word at the caret before its paragraph", () => {
    let state = select(stateFor(md), 7);
    state = apply(state, cycleAtCaret(state, 1));
    expect(state.doc.line(1).text).toBe("Start uno here.");
    state = select(state, at(state, "Plain") + 1);
    expect(cycleAtCaret(state, 1)).toBeNull();
  });

  it("cycles both ways at the caret: the word first, and else its paragraph", () => {
    let state = stateFor(":::alt\nFirst.\n:::or*\nSecond {{one|>uno|eins}} here.\n:::or\nThird.\n:::\n");
    state = select(state, at(state, "uno") + 1);
    state = apply(state, cycleAtCaret(state, -1));
    expect(state.doc.toString()).toBe("Second one here.");
    state = apply(state, cycleAtCaret(state, -1));
    expect(state.doc.toString()).toBe("Second eins here.");
    state = apply(state, cycleAtCaret(state, 1));
    expect(state.doc.toString()).toBe("Second one here.");
    state = select(state, at(state, "Second") + 1);
    state = apply(state, cycleAtCaret(state, -1));
    expect(state.doc.toString()).toBe("First.");
    expect(save(state)).toBe(":::alt*\nFirst.\n:::or\nSecond {{one|uno|eins}} here.\n:::or\nThird.\n:::\n");
    state = apply(state, cycleAtCaret(state, 1));
    expect(state.doc.toString()).toBe("Second one here.");
    expect(save(state)).toBe(":::alt\nFirst.\n:::or*\nSecond {{one|uno|eins}} here.\n:::or\nThird.\n:::\n");
  });
});

describe("ghosts and counting", () => {
  it("excludes ghosted words from the count", () => {
    const state = stateFor("one two {-three-} four\n");
    expect(countWords(state).words).toBe(3);
  });

  it("deletes ghosted text without leaving double spaces", () => {
    let state = stateFor("Keep this. {-Maybe cut.-} Keep that.\n");
    state = apply(state, deleteGhosts(state));
    expect(state.doc.toString()).toBe("Keep this. Keep that.");
  });

  it("accepts all current choices and keeps ghosts", () => {
    let state = stateFor("A {{one|>uno}} word. {-gone-}\n\n:::alt\nFirst.\n:::or*\nSecond.\n:::\n");
    state = apply(state, settleAll(state));
    expect(save(state)).toBe("A uno word. {-gone-}\n\nSecond.\n");
    expect(layersOf(state)).toEqual({ alts: [], ghosts: [{ from: 12, to: 16 }], versions: [] });
  });
});
