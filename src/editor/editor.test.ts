import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  addAltVariant,
  countWords,
  createAlt,
  cycleAlt,
  cycleAtCaret,
  jumpToItem,
  versionedItems,
  findAltById,
  forkParagraph,
  removeAltVariant,
  setParagraphActive,
  startsWithVowelSound,
  toggleGhost,
} from "./commands";
import { parseFile, serializeFile } from "./markdown";
import { dedupePlugin } from "./plugins";
import { deleteGhosts, settleAll } from "./commands";
import { buildCommands, PaletteContext } from "../palette/commands";
import { matchScore, rank } from "../palette/match";
import { describe as describeEditor } from "./setup";
import { applyFixes, longSentences, narrowChange } from "../ai/tasks";
import { labPlugin, labSpans, makeCuts, setLab } from "./lab";

const roundTrip = (md: string) => {
  const { doc, overflow } = parseFile(md);
  return serializeFile(doc, overflow);
};

const stateFor = (md: string) => EditorState.create({ doc: parseFile(md).doc, plugins: [dedupePlugin] });

const findText = (state: EditorState, needle: string) => {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
  });
  return found;
};

describe("markdown round trip", () => {
  it.each([
    "# The Title\n\nA plain paragraph.\n",
    "Much of the {{tension|pressure|>struggle}} comes from here.\n",
    "Keep this. ~~Maybe cut this.~~ Keep that.\n",
    ":::alt\nFirst version.\n:::or*\nSecond {{word|term}} version.\n:::\n",
    "Line one\nline two\n\n- a list\n- stays as text\n",
    "Body.\n\n<!-- overflow -->\n\nExtra notes\n\nmore notes\n",
    "~~ghost {{a|>b}} inside~~ after\n",
    "Escapes: \\~ and \\{ and **bold** and *em*.\n",
    "{{a\\|b|c\\}d}}\n",
  ])("keeps %j", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("treats unmatched syntax as literal text", () => {
    const { doc } = parseFile("open {{ never closed and ~~ too\n");
    expect(doc.textContent).toBe("open {{ never closed and ~~ too");
  });

  it("shows the active variant", () => {
    const { doc } = parseFile("the {{tension|>struggle}} here\n");
    expect(doc.textContent).toBe("the struggle here");
  });
});

describe("alternatives", () => {
  it("creates, adds, cycles, and removes", () => {
    let state = stateFor("Much of the tension comes from here.\n");
    const from = findText(state, "tension");
    const created = createAlt(state, from, from + "tension".length)!;
    state = state.apply(created.tr);
    state = state.apply(addAltVariant(state, created.id, "pressure")!);
    expect(state.doc.textContent).toBe("Much of the pressure comes from here.");
    state = state.apply(cycleAlt(state, created.id, 1)!);
    expect(state.doc.textContent).toBe("Much of the tension comes from here.");
    expect(serializeFile(state.doc, "")).toBe("Much of the {{tension|pressure}} comes from here.\n");
    state = state.apply(removeAltVariant(state, created.id, 1)!);
    expect(serializeFile(state.doc, "")).toBe("Much of the tension comes from here.\n");
  });

  it("keeps in-place edits of the active variant", () => {
    let state = stateFor("the {{tension|>struggle}} here\n");
    const pos = findText(state, "struggle");
    state = state.apply(state.tr.insertText("s", pos + "struggle".length - 1, pos + "struggle".length - 1));
    const id = findAltIdAt(state, pos);
    state = state.apply(cycleAlt(state, id, 1)!);
    state = state.apply(cycleAlt(state, id, 1)!);
    expect(state.doc.textContent).toBe("the strugglse here");
  });

  it("fixes a/an", () => {
    let state = stateFor("like a {{paperclip|eraser|thumbtack}} for example\n");
    const id = findAltIdAt(state, findText(state, "paperclip"));
    state = state.apply(cycleAlt(state, id, 1)!);
    expect(state.doc.textContent).toBe("like an eraser for example");
    state = state.apply(cycleAlt(state, id, 1)!);
    expect(state.doc.textContent).toBe("like a thumbtack for example");
    expect(startsWithVowelSound("hour")).toBe(true);
    expect(startsWithVowelSound("user")).toBe(false);
  });

  it("gives split alts new ids", () => {
    let state = stateFor("say {{hello world|hi}} now\n");
    const pos = findText(state, "world");
    state = state.apply(state.tr.split(pos));
    const ids = new Set<string>();
    state.doc.descendants((node) => {
      const m = node.marks.find((x) => x.type.name === "alt");
      if (m) ids.add(m.attrs.id);
    });
    expect(ids.size).toBe(2);
  });
});

describe("paragraph versions", () => {
  it("forks, edits in place, and switches", () => {
    let state = stateFor("Original paragraph.\n");
    state = state.apply(forkParagraph(state, 0)!);
    state = state.apply(state.tr.insertText(" Edited.", state.doc.content.size - 1));
    expect(serializeFile(state.doc, "")).toBe(":::alt\nOriginal paragraph.\n:::or*\nOriginal paragraph. Edited.\n:::\n");
    state = state.apply(setParagraphActive(state, 0, 0)!);
    expect(state.doc.textContent).toBe("Original paragraph.");
  });
});

describe("keyboard navigation", () => {
  const md = "Start {{one|uno}} here.\n\nPlain paragraph.\n\n:::alt\n{{two|dos}} and more.\n:::or\nOther version.\n:::\n";

  it("lists items in order, paragraph before its words", () => {
    const state = stateFor(md);
    expect(versionedItems(state.doc).map((i) => i.kind)).toEqual(["alt", "para", "alt"]);
  });

  it("jumps forward and back with wrap-around", () => {
    let state = stateFor(md);
    const items = versionedItems(state.doc);
    let last: number | null = null;
    const jump = (dir: 1 | -1) => {
      const r = jumpToItem(state, dir, last)!;
      state = state.apply(r.tr);
      last = r.index;
      return state.selection.head;
    };
    expect(jump(1)).toBe(items[0].from);
    expect(jump(1)).toBe(items[1].from);
    expect(jump(1)).toBe(items[2].from); // same spot as the paragraph, resolved by index
    expect(jump(1)).toBe(items[0].from); // wraps
    expect(jump(-1)).toBe(items[2].from);
  });

  it("cycles the word at the caret before its paragraph", () => {
    let state = stateFor(md);
    const pos = findText(state, "one") + 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    state = state.apply(cycleAtCaret(state, 1)!);
    expect(state.doc.firstChild!.textContent).toBe("Start uno here.");
    const plain = findText(state, "Plain") + 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, plain)));
    expect(cycleAtCaret(state, 1)).toBeNull();
  });
});

describe("ghost and counting", () => {
  it("ghosts a selection and excludes it from the count", () => {
    let state = stateFor("one two three four\n");
    const from = findText(state, "three");
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 5)));
    toggleGhost(state, (tr) => (state = state.apply(tr)));
    expect(serializeFile(state.doc, "")).toBe("one two ~~three~~ four\n");
    expect(countWords(state.doc).words).toBe(3);
  });
});

function findAltIdAt(state: EditorState, pos: number): string {
  const node = state.doc.nodeAt(pos)!;
  const id = node.marks.find((m) => m.type.name === "alt")!.attrs.id;
  expect(findAltById(state.doc, id)).not.toBeNull();
  return id;
}

describe("settling and cuts", () => {
  it("deletes ghosted text without leaving double spaces", () => {
    const state = stateFor("Keep this. ~~Maybe cut.~~ Keep that.\n");
    expect(state.apply(deleteGhosts(state)!).doc.textContent).toBe("Keep this. Keep that.");
  });

  it("accepts all current choices and keeps ghosts", () => {
    const md = "A {{one|>uno}} word. ~~gone~~\n\n:::alt\nFirst.\n:::or*\nSecond.\n:::\n";
    const state = stateFor(md);
    expect(serializeFile(state.apply(settleAll(state)!).doc, "")).toBe("A uno word. ~~gone~~\n\nSecond.\n");
  });
});

describe("command palette", () => {
  it("matches prefixes, word starts, and loose letters", () => {
    expect(matchScore("new", "New document")).toBeGreaterThan(matchScore("doc", "New document")!);
    expect(matchScore("nw doc", "New document")).not.toBeNull();
    expect(matchScore("xyz", "New document")).toBeNull();
    const items = [
      { title: "Ghost the selection", group: "Ghost" },
      { title: "New document", group: "Document", keywords: "file" },
    ];
    expect(rank(items, "file")[0].title).toBe("New document");
  });

  it("offers commands for what is under the caret", () => {
    let state = stateFor("the {{tension|pressure}} here\n");
    const pos = findText(state, "tension") + 2;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    const noop = () => {};
    const ctx: PaletteContext = {
      view: { state, dispatch: noop as never },
      info: describeEditor(state),
      layers: true,
      overflowOpen: false,
      altOpen: false,
      actions: {
        save: noop,
        open: noop,
        newDoc: noop,
        welcome: noop,
        toggleLayers: noop,
        setOverflowOpen: noop,
        openAlternatives: noop,
        closeAlternatives: noop,
        stash: noop,
        fork: noop,
        aiAlternatives: noop,
        openLab: noop,
        fixTypos: noop,
        check: noop,
        trim: noop,
        walkLab: noop,
        makeCuts: noop,
        ghostLab: noop,
        clearLab: noop,
        setKey: noop,
        connectSubscription: noop,
      },
    };
    const titles = buildCommands(ctx).map((c) => c.title);
    expect(titles).toContain("Use “pressure”");
    expect(titles).toContain("Keep “tension”, drop the other alternatives");
    expect(titles).not.toContain("Ghost the selection");
  });
});

describe("AI results on the page", () => {
  it("narrows a fix to whole words", () => {
    expect(narrowChange("sat on teh mat", "sat on the mat")).toMatchObject({ original: "teh", fixed: "the" });
    expect(narrowChange("however we go", "however, we go")).toMatchObject({ original: "however", fixed: "however," });
    expect(narrowChange("same", "same")).toBeNull();
  });

  it("applies fixes as alternatives that keep the original", () => {
    const state = stateFor("The cat sat on teh mat.\n");
    const { tr, count } = applyFixes(state, [
      { paragraph: 1, find: "on teh mat", replace: "on the mat" },
      { paragraph: 1, find: "not in the text", replace: "x" },
    ]);
    expect(count).toBe(1);
    const next = state.apply(tr);
    expect(next.doc.textContent).toBe("The cat sat on the mat.");
    expect(serializeFile(next.doc, "")).toBe("The cat sat on {{teh|>~the}} mat.\n");
  });

  it("makes cuts cleanly and drops marks when their text is edited", () => {
    let state = EditorState.create({ doc: parseFile("Keep this. Really just cut this. Keep that.\n").doc, plugins: [labPlugin] });
    const at = (t: string) => findText(state, t);
    const cut = { from: at("Really just cut this."), to: at("Really just cut this.") + "Really just cut this.".length };
    state = state.apply(setLab(state.tr, "cuts", { label: "Slight trim" }, [cut]));
    expect(labSpans(state)).toHaveLength(1);
    expect(state.apply(makeCuts(state)!).doc.textContent).toBe("Keep this. Keep that.");

    state = state.apply(setLab(state.tr, "marks", { label: "Hedges" }, [{ from: at("Really"), to: at("Really") + 6, reason: "hedge" }]));
    state = state.apply(state.tr.insertText("x", at("Really") + 2));
    expect(labSpans(state)).toHaveLength(0);
  });

  it("finds long sentences without AI", () => {
    const long = `${"word ".repeat(35).trim()}.`;
    const state = stateFor(`Short one. ${long} Another short.\n`);
    const spans = longSentences(state);
    expect(spans).toHaveLength(1);
    expect(state.doc.textBetween(spans[0].from, spans[0].to)).toBe(long);
  });
});
