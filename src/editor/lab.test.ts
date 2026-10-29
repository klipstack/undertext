import { redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  addRewrites,
  addSuggestions,
  alternativesPrompt,
  longSentences,
  narrowChange,
  rewritePrompt,
  writingIssuesFrom,
  writingIssuesPrompt,
} from "../ai/tasks";
import { matchScore, rank } from "../palette/match";
import { buildCommands, GROUPS, PaletteCommand, PaletteContext } from "../palette/commands";
import { createAlt, findAlt } from "./commands";
import { parsePage } from "./format";
import { applyFix, setHighlights, setWritingIssues } from "./highlights";
import { ghostLabNotice, ghostLabSpans, labSpans, labSpansThatCutAlternatives, makeCuts, setLab } from "./lab";
import { layersOf } from "./layers";
import { createEditorState, describe as describeEditor, pageMarkdown } from "./setup";
import { setGuesses, spellingChecked } from "./spelling";

const stateFor = (md: string) => {
  const { text, alts, ghosts, versions } = parsePage(md);
  return createEditorState(text, { alts, ghosts, versions });
};
const at = (state: EditorState, needle: string) => state.doc.toString().indexOf(needle);

describe("AI results on the page", () => {
  it("narrows a fix to whole words", () => {
    expect(narrowChange("sat on teh mat", "sat on the mat")).toMatchObject({ original: "teh", fixed: "the" });
    expect(narrowChange("however we go", "however, we go")).toMatchObject({ original: "however", fixed: "however," });
    expect(narrowChange("same", "same")).toBeNull();
  });

  it("marks Claude's writing issues on the words that change, with the fix", () => {
    const state = stateFor("# Rest will help yourself relax\n\nRest will help yourself relax. Plan the the plan. It works.\n");
    const issues = writingIssuesFrom(state, [
      { paragraph: 1, find: "help yourself relax", replace: "help you relax", reason: "In a heading." },
      { paragraph: 2, find: "help yourself relax", replace: "help you relax", reason: "Use “you” here." },
      { paragraph: 2, find: "the the plan", replace: "the plan", reason: "A word twice." },
      { paragraph: 2, find: "not in the text", replace: "x", reason: "Gone." },
      { paragraph: 2, find: "It works.", replace: "It works.", reason: "No change." },
      { paragraph: 2, find: "It works.", replace: "", reason: "Cut it." },
    ]);
    // A fix that deletes the whole quote leaves no word to swap in: the quote is marked, with no fix.
    expect(issues).toEqual([
      { from: 48, to: 56, kind: "grammar", note: "Use “you” here.", fix: "you" },
      { from: 73, to: 81, kind: "grammar", note: "A word twice.", fix: "plan" },
      { from: 83, to: 92, kind: "grammar", note: "Cut it.", fix: "" },
    ]);
  });

  it("offers no writing issue fix where it would save a different page", () => {
    const fixes = (md: string, find: string, replace: string) => {
      const state = stateFor(`${md}\n`);
      return writingIssuesFrom(state, [{ paragraph: 1, find, replace, reason: "Fix." }]).filter((i) => applyFix(state, i)).length;
    };
    expect(fixes("We met.Then,now go.", ",now", ", now")).toBe(1);
    // The whole word would cut into a ghost, take in code, or start a line with list or heading markup.
    expect(fixes("We {-met.Then-},now go.", ",now", ", now")).toBe(0);
    expect(fixes("Set `max size`=10.Then restart.", "10.Then", "10. Then")).toBe(0);
    expect(fixes("-Buy milk", "-Buy", "- Buy")).toBe(0);
    expect(fixes("#Setup", "#Setup", "# Setup")).toBe(0);
    expect(fixes("> -  Teh cat sat.", "-  Teh", "- Teh")).toBe(0);
    expect(fixes("- One.\n  -  Teh cat sat.", "-  Teh", "- Teh")).toBe(0);
    expect(fixes("Run `npm install to start.", "`npm install", "`npm install`")).toBe(0);
    expect(fixes("Some text here.\n\n    teh = 1", "teh", "the")).toBe(0);
  });

  it("leaves out a writing issue on a misspelled word when the Mac suggests the same fix", () => {
    // "recieve" at 3–10, which the Mac marks, and "teh" at 11–14, which it doesn't.
    let state = stateFor("We recieve teh mail.\n");
    state = state.update(spellingChecked([{ text: "We recieve teh mail.", checked: { language: "en", words: [[3, 10]] } }])).state;
    const answers = [
      { paragraph: 1, find: "recieve", replace: "receive", reason: "Spelling." },
      { paragraph: 1, find: "teh mail", replace: "the mail", reason: "Spelling." },
    ];
    const both = [
      { from: 3, to: 10, kind: "grammar", note: "Spelling.", fix: "receive" },
      { from: 11, to: 14, kind: "grammar", note: "Spelling.", fix: "the" },
    ];
    // Before the Mac's guesses come, or with none, Claude's fix is the only one: it stays.
    expect(writingIssuesFrom(state, answers)).toEqual(both);
    expect(writingIssuesFrom(state.update(setGuesses("recieve", [])).state, answers)).toEqual(both);

    state = state.update(setGuesses("recieve", ["receive", "relieve"])).state;
    expect(writingIssuesFrom(state, answers)).toEqual([both[1]]);
    // A fix the Mac doesn't suggest stays, and so does a fix of more than the word.
    const other = writingIssuesFrom(state, [
      { paragraph: 1, find: "recieve", replace: "received", reason: "Past tense." },
      { paragraph: 1, find: "teh mail", replace: "the mail", reason: "Spelling." },
    ]);
    expect(other).toEqual([{ from: 3, to: 10, kind: "grammar", note: "Past tense.", fix: "received" }, both[1]]);
    const wider = writingIssuesFrom(state, [{ paragraph: 1, find: "recieve teh", replace: "receive the", reason: "Two words." }]);
    expect(wider).toEqual([{ from: 3, to: 14, kind: "grammar", note: "Two words.", fix: "receive the" }]);
  });

  it("asks Claude for the punctuation rules can't find, and none they mark already", () => {
    const system = writingIssuesPrompt(stateFor("I went home, I slept.\n"))!.system;
    expect(system).toContain("intentional formatting. Paragraphs are numbered like [3].");
    expect(system).toContain(
      "In punctuation, look hardest for what simple rules can't find: a comma splice, “its” for “it’s” or the other way round, " +
        "a comma between a subject and its verb, and an aside that opens with a dash and closes with a comma.",
    );
    expect(system).toContain(
      "Leave out words that aren't words at all: the spell checker marks those. A fix adds no dash: give a comma " +
        "splice a period or a semicolon, and close an aside the way it opens, or make its dash a comma.",
    );
    expect(writingIssuesPrompt(stateFor(""))).toBeNull();
  });

  it("leaves out a writing issue whose fix adds a dash", () => {
    const state = stateFor("I went home, I slept. My brother — who lives in Ohio, came over.\n");
    const issues = writingIssuesFrom(state, [
      { paragraph: 1, find: "home, I slept", replace: "home—I slept", reason: "Comma splice." },
      { paragraph: 1, find: "Ohio, came", replace: "Ohio — came", reason: "Dash, then comma." },
      { paragraph: 1, find: "home, I slept", replace: "home; I slept", reason: "Comma splice." },
      { paragraph: 1, find: "brother — who", replace: "brother, who", reason: "Dash, then comma." },
    ]);
    // "home," at 7–12, and "brother —" at 25–34.
    expect(issues).toEqual([
      { from: 7, to: 12, kind: "grammar", note: "Comma splice.", fix: "home;" },
      { from: 25, to: 34, kind: "grammar", note: "Dash, then comma.", fix: "brother," },
    ]);
    // A dash at the start of the quote counts, and so do hyphens typed for one.
    const more = writingIssuesFrom(state, [
      { paragraph: 1, find: ", came over", replace: " — came over", reason: "Close the aside." },
      { paragraph: 1, find: "home, I", replace: "home -- I", reason: "Comma splice." },
    ]);
    expect(more).toEqual([]);
    // A fix may keep a dash that is there already.
    const kept = writingIssuesFrom(state, [{ paragraph: 1, find: "brother — who lives", replace: "brother — who live", reason: "Agree." }]);
    // "lives" at 39–44.
    expect(kept).toEqual([{ from: 39, to: 44, kind: "grammar", note: "Agree.", fix: "live" }]);
  });

  it("finds Claude's quote with straight quotes on a page with curly ones", () => {
    const state = stateFor("“Its fine,” she said. It’s late.\n");
    const issues = writingIssuesFrom(state, [
      { paragraph: 1, find: '"Its fine,"', replace: '"It\'s fine,"', reason: "It's." },
      { paragraph: 1, find: "It's late", replace: "It is late", reason: "Plainer." },
    ]);
    // The fix takes the page's curly quotes.
    expect(issues).toEqual([
      { from: 1, to: 4, kind: "grammar", note: "It's.", fix: "It’s" },
      { from: 22, to: 26, kind: "grammar", note: "Plainer.", fix: "It is" },
    ]);
    // And Claude's curly quotes find a page with straight ones.
    const plain = stateFor('"Its fine," she said.\n');
    expect(writingIssuesFrom(plain, [{ paragraph: 1, find: "“Its fine,”", replace: "“It’s fine,”", reason: "It's." }])).toEqual([
      { from: 1, to: 4, kind: "grammar", note: "It's.", fix: "It’s" },
    ]);
  });

  it("leaves Claude's writing issues in code and ghosts alone, and marks each spot once", () => {
    const state = stateFor("Run `teh` now. {-We recieve it.-}\n\n```\nwe recieve it\n```\n\nthe cat and the cat.\n\n    teh = 1\n");
    const issues = writingIssuesFrom(state, [
      { paragraph: 1, find: "teh", replace: "the", reason: "Spelling." },
      { paragraph: 1, find: "We recieve it.", replace: "We receive it.", reason: "Spelling." },
      { paragraph: 2, find: "recieve", replace: "receive", reason: "Spelling." },
      { paragraph: 3, find: "the cat", replace: "the dog", reason: "One." },
      { paragraph: 3, find: "the cat", replace: "the dog", reason: "Two." },
      { paragraph: 4, find: "teh", replace: "the", reason: "Indented code." },
    ]);
    expect(issues).toEqual([
      { from: 58, to: 61, kind: "grammar", note: "One.", fix: "dog" },
      { from: 70, to: 73, kind: "grammar", note: "Two.", fix: "dog" },
    ]);
  });

  it("keeps only Claude's rewrites that fix the mark, as no passive voice left", () => {
    // The answer one real run gave for "Suggest rewrites" on this sentence's passive voice.
    const answer = [
      "The door was shut quickly.",
      "Someone quickly closed the door.",
      "The door swung shut.",
      "The door was slammed shut.",
      "The door was hastily pulled closed.",
      "In an instant, the door was shut.",
    ];
    let state = stateFor("The door was quickly closed.\n");
    const made = createAlt(state, 0, 28)!;
    state = state.update(made.spec).state;
    state = state.update(addRewrites(state, made.id, "passive", answer)!).state;
    expect(findAlt(state, made.id)!.variants).toEqual([
      "The door was quickly closed.",
      "Someone quickly closed the door.",
      "The door swung shut.",
    ]);
    const saved = "{{The door was quickly closed.|~Someone quickly closed the door.|~The door swung shut.}}\n";
    expect(pageMarkdown(state, "")).toBe(saved);
    const step = (cmd: typeof undo) => cmd({ state, dispatch: (tr: Transaction) => (state = tr.state) });
    step(undo);
    // An alternative with one variant left saves as plain text.
    expect(pageMarkdown(state, "")).toBe("The door was quickly closed.\n");
    step(redo);
    expect(pageMarkdown(state, "")).toBe(saved);
    expect(addRewrites(state, made.id, "passive", ["It was shut.", "The door was closed."])).toBeNull();
    // A backtick or a lone carriage return would change the page the file reopens as.
    expect(addRewrites(state, made.id, "passive", ["He shut `the door.", "He shut it.\rThen he left.", "He <!-- shut it."])).toBeNull();
    // Half of some bold, or block markup where the sentence starts its line, would change the page.
    const kept = state.update(addRewrites(state, made.id, "passive", ["**He shut the door.", "- He shut it.", "He **shut** it."])!).state;
    expect(findAlt(kept, made.id)!.variants.slice(3)).toEqual(["He **shut** it."]);

    // A rewrite of a very hard sentence that is still hard doesn't fix it either.
    // 20 words, 99 letters: grade 12, hard.
    const hard =
      "Writers often build long sentences because each new idea wants another clause before the reader can pause or rest here.";
    state = state.update(addRewrites(state, made.id, "veryHard", [hard, "Writers pile on clauses. Readers need a rest."])!).state;
    expect(findAlt(state, made.id)!.variants.slice(3)).toEqual(["Writers pile on clauses. Readers need a rest."]);
  });

  it("tells Claude the goal, the words the checks flagged, and the rewrites the writer has", () => {
    // "The door was quickly closed by the wind that came in." at 16–69.
    let state = stateFor("She left early. The door was quickly closed by the wind that came in.\n");
    const made = createAlt(state, 16, 69)!;
    state = state.update(made.spec).state;
    const passive = rewritePrompt(state, made.id, "passive", "was quickly closed")!;
    expect(passive.system).toContain("Put it in the active voice: name who or what acts.");
    expect(passive.system).toContain("The checks flagged “was quickly closed” as passive voice.");
    expect(passive.prompt).toBe(
      "Paragraph:\nShe left early. ⟦The door was quickly closed by the wind that came in.⟧\n\n" +
        "Rewrites the writer has already: none.\n\nSuggest 6 rewrites of the marked text.",
    );
    // A hard sentence is flagged as a whole, so there is no phrase to name.
    const hard = rewritePrompt(state, made.id, "hard", "The door was quickly closed by the wind that came in.")!;
    expect(hard.system).toContain("Make it easier to read");
    expect(hard.system).not.toContain("flagged");

    state = stateFor("{{The door was closed.|Someone closed the door.}}\n");
    const alt = layersOf(state).alts[0];
    expect(rewritePrompt(state, alt.id, "passive", "was closed")!.prompt).toBe(
      "Paragraph:\n⟦The door was closed.⟧\n\nRewrites the writer has already: “Someone closed the door.”.\n\n" +
        "Suggest 6 rewrites of the marked text.",
    );
  });

  it("asks for plain words in place of a cliché, and drops a rewrite with one still in it", () => {
    // "It moved the needle." at 0–20.
    let state = stateFor("It moved the needle.\n");
    const made = createAlt(state, 0, 20)!;
    state = state.update(made.spec).state;
    const cliche = rewritePrompt(state, made.id, "cliche", "moved the needle")!;
    expect(cliche.system).toContain("Say it in plain words of its own, in place of the cliché.");
    expect(cliche.system).toContain("The checks flagged “moved the needle” as a cliché.");
    state = state.update(addRewrites(state, made.id, "cliche", ["It raised the bar.", "It changed sales a little."])!).state;
    expect(findAlt(state, made.id)!.variants.slice(1)).toEqual(["It changed sales a little."]);
  });

  it("drops Claude's rewrites that add a dash", () => {
    let state = stateFor("The door was quickly closed.\n");
    const made = createAlt(state, 0, 28)!;
    state = state.update(made.spec).state;
    const rewrites = ["Someone closed the door — fast.", "Someone shut it -- fast.", "Someone shut it - fast.", "Someone closed the door."];
    state = state.update(addRewrites(state, made.id, "passive", rewrites)!).state;
    expect(findAlt(state, made.id)!.variants).toEqual(["The door was quickly closed.", "Someone closed the door."]);

    // A sentence with dashes may keep as many, but no more.
    state = stateFor("Her plan — bold as ever — was quickly dropped.\n");
    const dashed = createAlt(state, 0, state.doc.length)!;
    state = state.update(dashed.spec).state;
    const more = ["She dropped her plan — bold as ever — fast.", "She dropped her plan, bold as ever.", "She — boldly — dropped — her plan."];
    state = state.update(addRewrites(state, dashed.id, "passive", more)!).state;
    expect(findAlt(state, dashed.id)!.variants).toEqual([
      "Her plan — bold as ever — was quickly dropped.",
      "She dropped her plan — bold as ever — fast.",
      "She dropped her plan, bold as ever.",
    ]);
  });

  it("drops Claude's other ways to say it that add a dash", () => {
    let state = stateFor("A quick reply.\n");
    const made = createAlt(state, 2, 7)!;
    state = state.update(made.spec).state;
    const texts = ["fast", "quick—very", "brisk", "swift – terse", "well-timed", "swift ― terse"];
    state = state.update(addSuggestions(state, made.id, texts)!).state;
    // A hyphen in a word isn't a dash.
    expect(findAlt(state, made.id)!.variants).toEqual(["quick", "fast", "brisk", "well-timed"]);
    const saved = "A {{quick|~fast|~brisk|~well-timed}} reply.\n";
    expect(pageMarkdown(state, "")).toBe(saved);
    const step = (cmd: typeof undo) => cmd({ state, dispatch: (tr: Transaction) => (state = tr.state) });
    step(undo);
    expect(pageMarkdown(state, "")).toBe("A quick reply.\n");
    step(redo);
    expect(pageMarkdown(state, "")).toBe(saved);
    expect(addSuggestions(state, made.id, ["quick — now"])).toBeNull();

    // A range isn't a dash.
    state = stateFor("It ran from 1990 to 1995.\n");
    const years = createAlt(state, 7, 24)!;
    state = state.update(years.spec).state;
    state = state.update(addSuggestions(state, years.id, ["from 1990–1995", "from 1990 – 1995", "on the Paris–London train"])!).state;
    expect(findAlt(state, years.id)!.variants).toEqual(["from 1990 to 1995", "from 1990–1995", "from 1990 – 1995", "on the Paris–London train"]);
  });

  it("asks for rewrites of a dash too many with no dash left, and keeps only those", () => {
    let state = stateFor("My plan — bold — failed. It was late — very late.\n");
    const made = createAlt(state, 25, 49)!;
    state = state.update(made.spec).state;
    expect(rewritePrompt(state, made.id, "dash", "— very late.")!.system).toContain(
      "Use a comma, a colon, parentheses, or a period in place of each dash, and no dash at all.",
    );
    // One rule about dashes: no second one that would allow some.
    expect(rewritePrompt(state, made.id, "dash", "— very late.")!.system).not.toContain("Use no more dashes");
    const rewrites = ["It was late, very late.", "It was very late.", "It was late – very late.", "It was late — so late.", "It was late -- so late."];
    state = state.update(addRewrites(state, made.id, "dash", rewrites)!).state;
    expect(findAlt(state, made.id)!.variants).toEqual(["It was late — very late.", "It was late, very late.", "It was very late."]);
    // A range or a hyphenated word isn't a dash.
    const ranges = ["It was late, on the Paris–London train.", "It was late, open 9am - 5pm.", "It was late, Monday - Friday."];
    state = state.update(addRewrites(state, made.id, "dash", ranges)!).state;
    expect(findAlt(state, made.id)!.variants.slice(3)).toEqual(ranges);
  });

  it("asks Claude not to add dashes", () => {
    let state = stateFor("A quick reply.\n");
    const made = createAlt(state, 2, 7)!;
    state = state.update(made.spec).state;
    const rule = "Use no more dashes than the marked text has: no — or – between words, no --, and no hyphen with a space on each side.";
    const alternatives = alternativesPrompt(state, made.id)!.system;
    expect(alternatives).toContain(rule);
    // An alternative drops in place, so it can't end the sentence.
    expect(alternatives).not.toContain("a period");
    expect(rewritePrompt(state, made.id, "passive", "quick")!.system).toContain(`${rule} Use a comma, a colon, parentheses, or a period instead.`);
  });

  it("finds long sentences without AI", () => {
    const long = `${"word ".repeat(35).trim()}.`;
    const state = stateFor(`Short one. ${long} Another short.\n`);
    const spans = longSentences(state);
    expect(spans).toHaveLength(1);
    expect(state.doc.sliceString(spans[0].from, spans[0].to)).toBe(long);
  });
});

describe("the Lab", () => {
  it("makes cuts cleanly and drops marks when their text is edited", () => {
    let state = stateFor("Keep this. Really just cut this. Keep that.\n");
    const cut = { from: at(state, "Really"), to: at(state, "Really") + "Really just cut this.".length };
    state = state.update(setLab("cuts", { label: "Slight trim" }, [cut])).state;
    expect(labSpans(state)).toHaveLength(1);
    expect(state.update(makeCuts(state)!).state.doc.toString()).toBe("Keep this. Keep that.");

    state = state.update(setLab("marks", { label: "Hedges" }, [{ from: at(state, "Really"), to: at(state, "Really") + 6, reason: "hedge" }])).state;
    state = state.update({ changes: { from: at(state, "Really") + 2, insert: "x" } }).state;
    expect(labSpans(state)).toHaveLength(0);
  });

  it("keeps marks when the edit is elsewhere", () => {
    let state = stateFor("Keep this. Really.\n");
    state = state.update(setLab("marks", { label: "Hedges" }, [{ from: at(state, "Really"), to: at(state, "Really") + 6 }])).state;
    state = state.update({ changes: { from: 0, insert: "Now " } }).state;
    expect(labSpans(state)).toEqual([{ from: 15, to: 21, reason: undefined }]);
  });

  it("turns marks into ghosts", () => {
    let state = stateFor("one two three\n");
    state = state.update(setLab("marks", { label: "Hedges" }, [{ from: 4, to: 7 }])).state;
    state = state.update(ghostLabSpans(state)!).state;
    expect(layersOf(state).ghosts).toEqual([{ from: 4, to: 7 }]);
    expect(labSpans(state)).toEqual([]);
  });

  it("leaves a mark on part of an alternative as a mark, since a save would lose its ghost", () => {
    // "two words" at 4–13 is an alternative. "one two" cuts into it; "three" doesn't.
    let state = stateFor("one {{two words|deux mots}} three four\n");
    state = state.update(setLab("marks", { label: "Hedges" }, [{ from: 0, to: 7, reason: "A" }, { from: 14, to: 19, reason: "B" }])).state;
    expect(labSpansThatCutAlternatives(state)).toEqual([{ from: 0, to: 7, reason: "A" }]);
    expect(ghostLabNotice(state)).toBe("1 mark stays: it covers part of an alternative, where a ghost isn't saved.");
    state = state.update(ghostLabSpans(state)!).state;
    expect(layersOf(state).ghosts).toEqual([{ from: 14, to: 19 }]);
    expect(labSpans(state)).toEqual([{ from: 0, to: 7, reason: "A" }]);
    expect(pageMarkdown(state, "")).toBe("one {{two words|deux mots}} {-three-} four\n");
    // With only such marks left, there's nothing to ghost.
    expect(ghostLabSpans(state)).toBeNull();
    const step = (cmd: typeof undo) => cmd({ state, dispatch: (tr: Transaction) => (state = tr.state) });
    step(undo);
    expect(pageMarkdown(state, "")).toBe("one {{two words|deux mots}} three four\n");
    step(redo);
    expect(pageMarkdown(state, "")).toBe("one {{two words|deux mots}} {-three-} four\n");

    // With several marks, only those that go are taken off.
    let many = stateFor("one {{two words|deux mots}} three four five\n");
    many = many.update(setLab("marks", { label: "Hedges" }, [{ from: 0, to: 7 }, { from: 14, to: 19 }, { from: 25, to: 29 }])).state;
    many = many.update(ghostLabSpans(many)!).state;
    expect(labSpans(many)).toEqual([{ from: 0, to: 7, reason: undefined }]);
    expect(layersOf(many).ghosts).toEqual([
      { from: 14, to: 19 },
      { from: 25, to: 29 },
    ]);

    const cuts = stateFor("one {{two words|deux mots}} three\n").update(
      setLab("cuts", { label: "Slight trim" }, [{ from: 0, to: 7 }, { from: 8, to: 19 }]),
    ).state;
    expect(ghostLabNotice(cuts)).toBe("2 proposed cuts stay: they cover part of an alternative, where a ghost isn't saved.");
    expect(ghostLabNotice(stateFor("one two\n"))).toBeNull();
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

  const noop = () => {};
  const ctx = (s: EditorState, panels: Partial<PaletteContext> = {}, actions: Partial<PaletteContext["actions"]> = {}): PaletteContext => ({
    view: { state: s, dispatch: noop as never },
    info: describeEditor(s),
    layers: true,
    appearance: { textSize: 15, theme: "system", lineWidth: "medium" },
    overflowOpen: false,
    reviewOpen: false,
    altOpen: false,
    ...panels,
    actions: {
      save: noop,
      open: noop,
      newDoc: noop,
      welcome: noop,
      toggleLayers: noop,
      setOverflowOpen: noop,
      setReviewOpen: noop,
      openAlternatives: noop,
      closeAlternatives: noop,
      stash: noop,
      fork: noop,
      aiAlternatives: noop,
      findIssues: noop,
      useFix: noop,
      useAllFixes: noop,
      check: noop,
      trim: noop,
      walkLab: noop,
      makeCuts: noop,
      ghostLab: noop,
      ghost: noop,
      firstAction: noop,
      clearLab: noop,
      setKey: noop,
      connectSubscription: noop,
      zoom: noop,
      setTheme: noop,
      setLineWidth: noop,
      ...actions,
    },
  });

  it("offers commands for what is under the caret", () => {
    let state = stateFor("the {{tension|pressure}} here\n\n:::alt\nOne.\n:::or*\nTwo.\n:::\n");
    state = state.update({ selection: EditorSelection.cursor(at(state, "tension") + 2) }).state;
    const titles = buildCommands(ctx(state)).map((c) => c.title);
    expect(titles).toContain("Use “pressure”");
    expect(titles).toContain("Keep “tension”, drop the other alternatives");
    expect(titles).toContain("Bold");
    expect(titles).toContain("Suggest other ways to say “tension”");
    expect(titles).not.toContain("Ghost the selection");

    state = state.update({ selection: EditorSelection.cursor(at(state, "Two")) }).state;
    expect(buildCommands(ctx(state)).map((c) => c.title)).toContain("Switch to version 1: “One.”");
  });

  it("lists the checks under Review, and opens or closes it", () => {
    const state = stateFor("One sentence here.\n");
    const asked: boolean[] = [];
    const find = (commands: PaletteCommand[], id: string) => commands.find((c) => c.id === id)!;

    const closed = buildCommands(ctx(state, {}, { setReviewOpen: (open) => asked.push(open) }));
    expect(find(closed, "lab.open")).toMatchObject({ group: "Review", title: "Open Review", shortcut: "⌘⇧E" });
    expect(find(closed, "lab.issues").group).toBe("Review");
    expect(closed.some((c) => c.id === "lab.typos")).toBe(false);
    expect(find(closed, "lab.trim.half").group).toBe("Review");
    expect(find(closed, "overflow.toggle").title).toBe("Open Overflow");
    find(closed, "lab.open").run();
    expect(asked).toEqual([true]);

    const open = buildCommands(ctx(state, { reviewOpen: true }, { setReviewOpen: (open) => asked.push(open) }));
    expect(find(open, "lab.open").title).toBe("Close Review");
    expect(find(open, "overflow.toggle").title).toBe("Open Overflow");
    find(open, "lab.open").run();
    expect(asked).toEqual([true, false]);

    expect(GROUPS).toContain("Review");
    expect(GROUPS).not.toContain("Lab");
  });

  it("lists ⌥↩'s ghost or rewrite for the mark at the caret", () => {
    const ran: string[] = [];
    const find = (state: EditorState) =>
      buildCommands(ctx(state, {}, { firstAction: () => ran.push("first") })).find((c) => c.id === "lab.firstAction");
    let state = stateFor("It is really done.\n").update(setHighlights({ on: true })).state;
    state = state.update({ selection: EditorSelection.cursor(8) }).state;
    expect(find(state)).toMatchObject({ group: "Review", title: "Ghost it", shortcut: "⌥↩" });
    find(state)!.run();
    expect(ran).toEqual(["first"]);
    // A suggestion has its own entry, "Use the fix".
    state = stateFor("She walked slowly home.\n").update(setHighlights({ on: true })).state;
    expect(find(state.update({ selection: EditorSelection.cursor(6) }).state)).toBeUndefined();
  });

  it("ghosts the selection through the app, which says why when it can't", () => {
    const ran: string[] = [];
    const state = stateFor("one {{two words|deux mots}} three\n").update({ selection: EditorSelection.range(4, 7) }).state;
    const entry = buildCommands(ctx(state, {}, { ghost: () => ran.push("ghost") })).find((c) => c.id === "ghost.add")!;
    entry.run();
    expect(ran).toEqual(["ghost"]);
  });

  it("finds writing issues, and offers the fix at the caret", () => {
    const ran: string[] = [];
    const find = (commands: PaletteCommand[], id: string) => commands.find((c) => c.id === id);
    const actions = { findIssues: () => ran.push("find"), useFix: () => ran.push("fix") };
    let state = stateFor("Rest will help yourself relax.\n").update(setHighlights({ on: true })).state;
    expect(find(buildCommands(ctx(state, {}, actions)), "lab.issues")).toMatchObject({ group: "Review", title: "Find writing issues" });
    expect(find(buildCommands(ctx(state, {}, actions)), "lab.useFix")).toBeUndefined();

    state = state.update(setWritingIssues([{ from: 15, to: 23, kind: "grammar", note: "Use “you”.", fix: "you" }])).state;
    state = state.update({ selection: EditorSelection.cursor(17) }).state;
    const commands = buildCommands(ctx(state, {}, actions));
    expect(find(commands, "lab.useFix")).toMatchObject({ group: "Review", title: "Use the fix: “you”" });
    find(commands, "lab.issues")!.run();
    find(commands, "lab.useFix")!.run();
    expect(ran).toEqual(["find", "fix"]);
  });

  it("offers Use all while a writing issue's fix fits", () => {
    const ran: string[] = [];
    const find = (state: EditorState) => buildCommands(ctx(state, {}, { useAllFixes: () => ran.push("all") })).find((c) => c.id === "lab.fixAll");
    let state = stateFor("Fix teh and recieve it.\n").update(setHighlights({ on: true })).state;
    expect(find(state)).toBeUndefined();
    state = state.update(setWritingIssues([{ from: 4, to: 7, kind: "grammar", note: "Spelling.", fix: "the" }])).state;
    expect(find(state)).toMatchObject({ group: "Review", title: "Use 1 fix" });
    state = state.update(
      setWritingIssues([
        { from: 4, to: 7, kind: "grammar", note: "Spelling.", fix: "the" },
        { from: 12, to: 19, kind: "grammar", note: "Spelling.", fix: "receive" },
      ]),
    ).state;
    const entry = find(state)!;
    expect(entry.title).toBe("Use all 2 fixes");
    entry.run();
    expect(ran).toEqual(["all"]);
  });

  it("offers the text sizes, themes, and line widths the page isn't using", () => {
    const state = stateFor("Some text.\n");
    const view = (appearance: PaletteContext["appearance"]) =>
      buildCommands(ctx(state, { appearance }))
        .filter((c) => c.group === "View")
        .map((c) => `${c.title}${c.shortcut ? ` ${c.shortcut}` : ""}`);
    expect(view({ textSize: 15, theme: "system", lineWidth: "medium" })).toEqual([
      "Hide layers ⌘⇧L",
      "Open the Alternatives panel ⌘⇧A",
      "Bigger text ⌘+",
      "Smaller text ⌘−",
      "Theme: light",
      "Theme: dark",
      "Line width: narrow",
      "Line width: wide",
    ]);
    expect(view({ textSize: 28, theme: "dark", lineWidth: "wide" })).toEqual([
      "Hide layers ⌘⇧L",
      "Open the Alternatives panel ⌘⇧A",
      "Smaller text ⌘−",
      "Default text size ⌘0",
      "Theme: match the system",
      "Theme: light",
      "Line width: narrow",
      "Line width: medium",
    ]);
    expect(view({ textSize: 12, theme: "light", lineWidth: "narrow" }).slice(2)).toEqual([
      "Bigger text ⌘+",
      "Default text size ⌘0",
      "Theme: match the system",
      "Theme: dark",
      "Line width: medium",
      "Line width: wide",
    ]);
  });

  it("runs the appearance commands", () => {
    const ran: string[] = [];
    const commands = buildCommands(
      ctx(
        stateFor("Some text.\n"),
        { appearance: { textSize: 20, theme: "system", lineWidth: "medium" } },
        {
          zoom: (step) => ran.push(`zoom ${step}`),
          setTheme: (theme) => ran.push(`theme ${theme}`),
          setLineWidth: (width) => ran.push(`width ${width}`),
        },
      ),
    );
    const titles = ["Bigger text", "Smaller text", "Default text size", "Theme: light", "Theme: dark", "Line width: narrow", "Line width: wide"];
    for (const title of titles) commands.find((c) => c.title === title)!.run();
    expect(ran).toEqual(["zoom 1", "zoom -1", "zoom 0", "theme light", "theme dark", "width narrow", "width wide"]);
  });
});
