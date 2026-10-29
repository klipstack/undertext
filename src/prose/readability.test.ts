import { describe, expect, it } from "vitest";
import { Kind } from "./issues";
import { createChecker } from "./checker";
import { checkPage } from "./readability";
import { sentences } from "./sentences";

/** Each issue as its kind and the text it covers, in page order. */
const found = (text: string, kinds?: Kind[]) =>
  checkPage(text)
    .issues.filter((i) => !kinds || kinds.includes(i.kind))
    .map((i) => [i.kind, text.slice(i.from, i.to)]);

const split = (text: string) => sentences(text).map((s) => text.slice(s.from, s.to));

// 20 words, 99 letters: 4.71 × 99/20 + 0.5 × 20 − 21.43 = 11.88, grade 12.
const HARD =
  "Writers often build long sentences because each new idea wants another clause before the reader can pause or rest here.";
// 19 words, 167 letters: 4.71 × 167/19 + 0.5 × 19 − 21.43 = 29.47, grade 29.
const VERY_HARD =
  "Organizations underestimate how complicated documentation becomes when several departments contribute overlapping requirements without coordinating their terminology or their priorities.";

describe("sentences", () => {
  it("splits after . ! and ?, but not after an abbreviation, an initial, or a decimal point", () => {
    expect(split("Mr. Smith arrived at 3.5 p.m. on Friday. He left early! Did he?")).toEqual([
      "Mr. Smith arrived at 3.5 p.m. on Friday.",
      "He left early!",
      "Did he?",
    ]);
    expect(split("J. K. Rowling wrote it. Use short words, e.g. this one.")).toEqual([
      "J. K. Rowling wrote it.",
      "Use short words, e.g. this one.",
    ]);
  });

  it("ends a sentence at a word that is also an abbreviation, unless a number follows", () => {
    expect(split("Pick yes or no. Then go on. See No. 5 and fig. 2 for more.")).toEqual([
      "Pick yes or no.",
      "Then go on.",
      "See No. 5 and fig. 2 for more.",
    ]);
  });

  it("keeps closing quotes with their sentence, and ends a sentence at an ellipsis", () => {
    expect(split('She said, "Stop." Then she left.')).toEqual(['She said, "Stop."', "Then she left."]);
    expect(split("Wait... What happened?")).toEqual(["Wait...", "What happened?"]);
  });

  it("ends a sentence at an initial or a dotted word when a word that opens sentences follows", () => {
    expect(split("I got an A. Then I left. We need plan B. The first one failed.")).toEqual([
      "I got an A.",
      "Then I left.",
      "We need plan B.",
      "The first one failed.",
    ]);
    expect(split("He moved to the U.S. She stayed. We left at 5 p.m. The rain stopped. Visit example.com. Then sign up.")).toEqual([
      "He moved to the U.S.",
      "She stayed.",
      "We left at 5 p.m.",
      "The rain stopped.",
      "Visit example.com.",
      "Then sign up.",
    ]);
    expect(split("He works at Acme Inc. The firm grew.")).toEqual(["He works at Acme Inc.", "The firm grew."]);
  });

  it("keeps a name's initials, a title, or e.g. in its sentence, whatever follows", () => {
    expect(split("John F. Kennedy was president. J. I. Rodale founded it.")).toEqual([
      "John F. Kennedy was president.",
      "J. I. Rodale founded it.",
    ]);
    expect(split("Gen. Patton led them. Sen. Warren spoke. Some bands, e.g. The Who, toured.")).toEqual([
      "Gen. Patton led them.",
      "Sen. Warren spoke.",
      "Some bands, e.g. The Who, toured.",
    ]);
  });

  it("goes on past a version, a dotted name, a title, or a quoted question", () => {
    expect(split("Version 2.0 shipped. Use Node.js for it. He earned a Ph.D. in physics. T.S. Eliot read it.")).toEqual([
      "Version 2.0 shipped.",
      "Use Node.js for it.",
      "He earned a Ph.D. in physics.",
      "T.S. Eliot read it.",
    ]);
    expect(split("The U.S. Army arrived. Lt. Col. Smith arrived. Capt. Jones left. Dr. Who is a show.")).toEqual([
      "The U.S. Army arrived.",
      "Lt. Col. Smith arrived.",
      "Capt. Jones left.",
      "Dr. Who is a show.",
    ]);
    expect(split('"Why?" she asked. Apples, pears, etc. are fruit. (See below.) Then we left.')).toEqual([
      '"Why?" she asked.',
      "Apples, pears, etc. are fruit.",
      "(See below.)",
      "Then we left.",
    ]);
  });

  it("ends a sentence after an abbreviation, a letter, or a number that closes it", () => {
    expect(split("She lives on Main St. It is quiet. Vitamin C. It helps. The rate was 3.5. Then it fell.")).toEqual([
      "She lives on Main St.",
      "It is quiet.",
      "Vitamin C.",
      "It helps.",
      "The rate was 3.5.",
      "Then it fell.",
    ]);
    expect(split("Read ch. 3 first. Then ch. 4. He said no. Kennedy agreed.")).toEqual([
      "Read ch. 3 first.",
      "Then ch. 4.",
      "He said no.",
      "Kennedy agreed.",
    ]);
  });

  it("reads a short month as an abbreviation, and ends a sentence at …", () => {
    expect(split("It was Jan. 5 when we met. We left in Sept. Then it snowed.")).toEqual([
      "It was Jan. 5 when we met.",
      "We left in Sept.",
      "Then it snowed.",
    ]);
    expect(split("Wait… What happened? He paused… then left.")).toEqual(["Wait…", "What happened?", "He paused… then left."]);
  });

  it("counts text with no closing punctuation as a sentence", () => {
    expect(split("Notes: the plan for today")).toEqual(["Notes: the plan for today"]);
  });
});

describe("the grade", () => {
  it("is the Automated Readability Index of the page", () => {
    // 11 words, 55 letters, 2 sentences: 4.71 × 55/11 + 0.5 × 11/2 − 21.43 = 4.87, grade 5.
    const report = checkPage("Readers like short sentences with plain words. Long ones tire them.\n");
    expect(report).toMatchObject({ words: 11, letters: 55, sentences: 2, grade: 5 });
  });

  it("is never below zero, and is null without prose", () => {
    expect(checkPage("The cat sat on the mat.").grade).toBe(0);
    expect(checkPage("# Only a heading\n").grade).toBeNull();
  });
});

describe("hard sentences", () => {
  it("marks a sentence of 14 or more words by its own grade: hard from 10, very hard from 14", () => {
    const text = `Short and plain. ${HARD} ${VERY_HARD}`;
    expect(found(text, ["hard", "veryHard"])).toEqual([
      ["hard", HARD],
      ["veryHard", VERY_HARD],
    ]);
    const notes = checkPage(text).issues.map((i) => i.note);
    expect(notes).toEqual(["Hard to read. 20 words.", "Very hard to read. 19 words."]);
  });

  it("draws the lines at grade 10 and grade 14", () => {
    // 14 words: 13 of 5 letters and a last one. 4.71 × letters/14 + 0.5 × 14 − 21.43:
    // 71 letters 9.46, grade 9. 72 letters 9.79, grade 10. 83 letters 13.49, grade 13. 84 letters 13.83, grade 14.
    const kinds = (last: string) => checkPage(`${"words ".repeat(13)}${last}.`).issues.map((i) => i.kind);
    expect(kinds("abcdef")).toEqual([]);
    expect(kinds("abcdefg")).toEqual(["hard"]);
    expect(kinds("abcdefghijklmnopqr")).toEqual(["hard"]);
    expect(kinds("abcdefghijklmnopqrs")).toEqual(["veryHard"]);
  });

  it("leaves a sentence under 14 words alone, however long its words", () => {
    // 13 words.
    const short =
      "Organizations underestimate how complicated documentation becomes when several departments contribute overlapping requirements today.";
    // 14 words, 125 letters: 4.71 × 125/14 + 0.5 × 14 − 21.43 = 27.62, grade 28.
    const long =
      "Organizations underestimate how complicated documentation becomes when several departments contribute overlapping requirements in projects.";
    expect(found(short)).toEqual([]);
    expect(found(long)).toEqual([["veryHard", long]]);
  });
});

describe("weakeners", () => {
  it("marks adverbs, but not words that only end in -ly", () => {
    expect(found("She quickly and quietly left the family home early. Only one did.")).toEqual([
      ["adverb", "quickly"],
      ["adverb", "quietly"],
    ]);
  });

  it("skips the adverbs Hemingway leaves alone", () => {
    expect(found("It usually works. Finally, we left. It actually works. It recently changed. We left immediately.")).toEqual([]);
  });

  it("says to cut an adverb when the sentence holds without it", () => {
    expect(checkPage("It typically works.").issues).toEqual([
      { from: 3, to: 12, kind: "adverb", note: "Adverb. Cut it if the sentence holds without it." },
    ]);
  });

  it("marks qualifiers, intensifiers, and fillers, and counts an adverb among them as an adverb too", () => {
    expect(found("I think this is really very good, and basically it just works.")).toEqual([
      ["qualifier", "I think"],
      ["intensifier", "really"],
      ["adverb", "really"],
      ["intensifier", "very"],
      ["filler", "basically"],
      ["adverb", "basically"],
      ["qualifier", "just"],
    ]);
  });

  it("counts each mark once in the weakeners' total, as Hemingway does", () => {
    // 3 adverbs, 1 passive, 1 intensifier, 1 weak verb. "Really" and "walked slowly" are one mark
    // each; the adverb in "was quickly closed" is its own. Hemingway says 4 weakeners.
    const report = checkPage("He ran really fast. She walked slowly home. The door was quickly closed.");
    expect(report.issues.filter((i) => i.kind === "adverb")).toHaveLength(3);
    expect(report.weakeners).toBe(4);
  });

  it("leaves the hedges alone that Hemingway doesn't mark", () => {
    expect(found("Use plain words rather than jargon. It is rather slow. It is kind of slow. It is quite slow. You know, it works.")).toEqual([]);
    expect(found("It probably works.")).toEqual([["adverb", "probably"]]);
  });

  it("marks passive voice, and the words inside it too", () => {
    expect(found("The report was written by the team. The bug is fixed. The door was quickly closed.")).toEqual([
      ["passive", "was written"],
      ["passive", "is fixed"],
      ["passive", "was quickly closed"],
      ["adverb", "quickly"],
    ]);
    expect(found("It is red. It was indeed hard. There was a need for speed.")).toEqual([]);
  });
});

// The lists follow what Hemingway's web editor marked on test sentences, in October 2026.
describe("weak verbs, hidden actions, and negatives", () => {
  it("marks a plain verb and adverb that one stronger verb replaces, in the same tense", () => {
    const text = "He walked slowly home. She eats quickly. They are speaking softly. She looked closely. It runs slowly.";
    expect(found(text)).toEqual([
      ["weakVerb", "walked slowly"],
      ["adverb", "slowly"],
      ["weakVerb", "eats quickly"],
      ["adverb", "quickly"],
      ["weakVerb", "speaking softly"],
      ["adverb", "softly"],
      ["adverb", "closely"],
      ["adverb", "slowly"],
    ]);
    expect(checkPage(text).issues.filter((i) => i.kind === "weakVerb").map((i) => i.note)).toEqual([
      "Weak verb. Try “strolled”.",
      "Weak verb. Try “gobbles”.",
      "Weak verb. Try “whispering”.",
    ]);
    // "Run" is also the past participle; the present tense wins.
    expect(checkPage("They run quickly.").issues[0].note).toBe("Weak verb. Try “sprint”.");
  });

  it("leaves get and phrasal verbs alone", () => {
    expect(found("She gets it. Sales got better. We put off the launch. Let us get started. Find out more.")).toEqual([]);
  });

  it("marks the hidden actions on Hemingway's list, in any tense", () => {
    const text =
      "We made a decision. They are reaching an agreement. She gave consideration to it. He is able to swim. We take into consideration the cost.";
    expect(found(text)).toEqual([
      ["hidden", "made a decision"],
      ["hidden", "reaching an agreement"],
      ["hidden", "gave consideration to"],
      ["hidden", "is able to"],
      ["hidden", "take into consideration"],
    ]);
    expect(checkPage(text).issues.map((i) => i.note)).toEqual([
      "Hidden action. Try “decided”.",
      "Hidden action. Try “agreeing”.",
      "Hidden action. Try “considered”.",
      "Hidden action. Try “can”.",
      "Hidden action. Try “consider”.",
    ]);
  });

  it("leaves a hidden action alone with other words in it", () => {
    expect(found("We made the decision to leave. They make decisions. We made a quick decision. She gave an explanation.")).toEqual([]);
  });

  it("marks a negative that has a positive word, but not every not", () => {
    const text = "The tool does not have a menu. It doesn't include tests. We do not need that.";
    expect(found(text)).toEqual([
      ["negative", "does not have"],
      ["negative", "doesn't include"],
    ]);
    expect(checkPage(text).issues.map((i) => i.note)).toEqual(["Negative. Try “lacks”.", "Negative. Try “excludes”."]);
  });

  it("marks the other negatives on Hemingway's list, and only those", () => {
    const text = "She does not notice. We did not agree. He is not honest. It does not work. It is not clear.";
    expect(found(text)).toEqual([
      ["negative", "does not notice"],
      ["negative", "did not agree"],
      ["negative", "not honest"],
    ]);
    expect(checkPage(text).issues.map((i) => i.note)).toEqual([
      "Negative. Try “overlooks”.",
      "Negative. Try “disagreed”.",
      "Negative. Try “dishonest”.",
    ]);
  });

  it("reads a curly apostrophe as a straight one", () => {
    const text = "It doesn’t include tests.";
    expect(found(text)).toEqual([["negative", "doesn’t include"]]);
    expect(checkPage(text).issues[0].note).toBe("Negative. Try “excludes”.");
  });

  it("leaves indirect openings alone, as Hemingway does", () => {
    expect(found("There are many people who agree. It is clear that we won.")).toEqual([]);
  });
});

describe("simpler words", () => {
  it("marks a word or phrase with a plainer one, in any form or case", () => {
    const text = "Utilize it in order to assist users. She utilized it.";
    expect(found(text)).toEqual([
      ["simpler", "Utilize"],
      ["simpler", "in order to"],
      ["simpler", "assist"],
      ["simpler", "utilized"],
    ]);
    expect(checkPage(text).issues.map((i) => i.note)).toEqual([
      "Simpler: Use.",
      "Simpler: to.",
      "Simpler: help.",
      "Simpler: used.",
    ]);
  });

  it("marks the forms of a word that ends in y or doubles its last letter", () => {
    expect(found("It modifies and modified what we transmitted while transmitting.")).toEqual([
      ["simpler", "modifies"],
      ["simpler", "modified"],
      ["simpler", "transmitted"],
      ["simpler", "transmitting"],
    ]);
  });

  it("prefers the longer phrase where two overlap", () => {
    expect(found("We stopped due to the fact that it rained.")).toEqual([["simpler", "due to the fact that"]]);
  });

  it("marks an adverb with a simpler alternative once, as a simpler word", () => {
    expect(found("We meet frequently.")).toEqual([["simpler", "frequently"]]);
  });

  it("offers one word for a negative phrase", () => {
    const text = "Not many came. We are not often late.";
    expect(found(text)).toEqual([
      ["simpler", "Not many"],
      ["simpler", "not often"],
    ]);
    expect(checkPage(text).issues.map((i) => i.note)).toEqual(["Simpler: Few.", "Simpler: rarely."]);
  });
});

describe("clutter, as Zinsser has it", () => {
  /** Each mark of these kinds as its text and its suggestion. */
  const fixes = (text: string, kinds: Kind[]) =>
    checkPage(text)
      .issues.filter((i) => kinds.includes(i.kind))
      .map((i) => [text.slice(i.from, i.to), i.fix]);

  it("marks his wordy phrases as simpler words, with the plain word", () => {
    const text =
      "At the present time we wait until such time as they call. It is referred to as a stub, with the possible exception of one. I personally test it for the purpose of learning.";
    expect(fixes(text, ["simpler"])).toEqual([
      ["At the present time", "Now"],
      ["until such time as", "until"],
      ["referred to as", "called"],
      ["with the possible exception of", "except"],
      ["I personally", "I"],
      ["for the purpose of", "for"],
    ]);
    // "Personally" is marked once, as part of its phrase.
    expect(found(text, ["adverb"])).toEqual([]);
  });

  it("prefers his longer phrase to a redundant pair inside it", () => {
    const text = "Despite the fact that it rained, we met in close proximity to the park. A personal friend of mine came in a timely manner.";
    expect(fixes(text, ["simpler", "redundant"])).toEqual([
      ["Despite the fact that", "Although"],
      ["in close proximity to", "near"],
      ["A personal friend of mine", "My friend"],
      ["in a timely manner", "promptly"],
    ]);
  });

  it("marks currently, which Hemingway leaves alone, with now", () => {
    expect(fixes("We currently have two. Currently, it waits.", ["simpler", "adverb"])).toEqual([
      ["currently", "now"],
      ["Currently", "Now"],
    ]);
  });

  it("suggests But for a sentence that opens with However and a comma", () => {
    const text = "However, it failed. It failed, however, twice. It rained. However, we went. However you look at it, it failed.\n\n- However, the list holds.\n";
    expect(fixes(text, ["simpler"])).toEqual([
      ["However,", "But"],
      ["However,", "But"],
      ["However,", "But"],
    ]);
    expect(checkPage(text).issues[0]).toMatchObject({ from: 0, to: 8, kind: "simpler", note: "Simpler: But." });
  });

  it("marks his useless phrases as fillers", () => {
    const text = "I might add that it works. It is interesting to note that it works. It should be pointed out that it works.";
    expect(found(text, ["filler"])).toEqual([
      ["filler", "I might add"],
      ["filler", "It is interesting to note"],
      ["filler", "It should be pointed out"],
    ]);
  });

  it("marks a redundant pair with the word that says it all, in any form or case", () => {
    const text = "The end result was free gifts. Past histories repeat. She reverted back, then returned back home. Each and every PIN number was very unique.";
    expect(fixes(text, ["redundant"])).toEqual([
      ["end result", "result"],
      ["free gifts", "gifts"],
      ["Past histories", "Histories"],
      ["reverted back", "reverted"],
      ["returned back", "returned"],
      ["Each and every", "Every"],
      ["PIN number", "PIN"],
      ["very unique", "unique"],
    ]);
    expect(checkPage(text).issues.find((i) => i.kind === "redundant")?.note).toBe("Redundant. Try “result”.");
  });

  it("marks a redundant pair once, not the adverb or intensifier in it, and counts it as one weakener", () => {
    const text = "She whispered quietly. It is very unique.";
    expect(found(text)).toEqual([
      ["redundant", "whispered quietly"],
      ["redundant", "very unique"],
    ]);
    expect(checkPage(text).weakeners).toBe(2);
  });

  it("marks clichés in any tense, with no suggestion, as weakeners", () => {
    const text =
      "At the end of the day, it was low-hanging fruit. He thought outside the box and moved the needle. We will hit the ground running.";
    expect(fixes(text, ["cliche"])).toEqual([
      ["At the end of the day", undefined],
      ["low-hanging fruit", undefined],
      ["thought outside the box", undefined],
      ["moved the needle", undefined],
      ["hit the ground running", undefined],
    ]);
    const report = checkPage(text);
    expect(report.issues[0].note).toBe("Cliché. Say it in your own words.");
    expect(report.weakeners).toBe(5);
  });

  it("leaves the words of a cliché alone when they say something else", () => {
    expect(found("The game changed. We think inside the box. The fruit hung low.")).toEqual([]);
  });
});

describe("suggestions", () => {
  /** Each mark that has a suggestion, as its text and the suggestion. */
  const fixes = (text: string) =>
    checkPage(text)
      .issues.filter((i) => i.fix !== undefined)
      .map((i) => [text.slice(i.from, i.to), i.fix]);

  it("put a hidden action's verb in the phrase's tense and person", () => {
    expect(fixes("We made a decision. She makes a decision. They are making a decision. We make a decision.")).toEqual([
      ["made a decision", "decided"],
      ["makes a decision", "decides"],
      ["making a decision", "deciding"],
      ["make a decision", "decide"],
    ]);
    expect(fixes("She is in agreement with us. They were in agreement with us. We are in agreement with them.")).toEqual([
      ["is in agreement with", "agrees with"],
      ["were in agreement with", "agreed with"],
      ["are in agreement with", "agree with"],
    ]);
  });

  it("tell a past participle from a past tense by the word before it", () => {
    expect(fixes("She made a choice. She has made a choice. We had knowledge of it. We have had knowledge of it.")).toEqual([
      ["made a choice", "chose"],
      ["made a choice", "chosen"],
      ["had knowledge of", "knew"],
      ["had knowledge of", "known"],
    ]);
    expect(fixes("He has walked carefully. He walked carefully.")).toEqual([
      ["walked carefully", "trodden"],
      ["walked carefully", "trod"],
    ]);
  });

  it("offer can and could only where they fit", () => {
    const text =
      "He is able to swim. He was able to swim. He will be able to swim. She had the ability to sing. She will have the ability to sing.";
    expect(fixes(text)).toEqual([
      ["is able to", "can"],
      ["was able to", "could"],
      ["had the ability to", "could"],
    ]);
    // "Will can" isn't English: the mark stays, with no suggestion.
    const will = checkPage(text).issues.find((i) => text.slice(i.from, i.to) === "be able to");
    expect(will).toMatchObject({ kind: "hidden", note: "Hidden action. Use a plain verb." });
    expect(will?.fix).toBeUndefined();
  });

  it("put a simpler word in the form of the word it replaces", () => {
    expect(
      fixes("We utilized it, utilizing all. She finalizes it. He modified it. They transmitted it. We acquired it. It was acquired."),
    ).toEqual([
      ["utilized", "used"],
      ["utilizing", "using"],
      ["finalizes", "finishes"],
      ["modified", "changed"],
      ["transmitted", "sent"],
      ["acquired", "got"],
      ["acquired", "gotten"],
    ]);
  });

  it("see a participle after a contraction, a not, an adverb, or a question", () => {
    expect(fixes("She's made a choice. We haven't made a choice. He has finally made a choice. Has she made a choice?")).toEqual([
      ["made a choice", "chosen"],
      ["made a choice", "chosen"],
      ["made a choice", "chosen"],
      ["made a choice", "chosen"],
    ]);
  });

  it("take a statement for one, and look far enough back", () => {
    expect(fixes("The truth is we made a choice. Sally's family made a choice. We haven't recently made a choice.")).toEqual([
      ["made a choice", "chose"],
      ["made a choice", "chose"],
      ["made a choice", "chosen"],
    ]);
    expect(fixes("We'll have the ability to swim. We cannot have the ability to swim.")).toEqual([]);
  });

  it("offer no can after a negated or questioning modal", () => {
    const text = "We will not have the ability to stop it. We won't have the ability to stop it. Will they have the ability to stop it?";
    expect(found(text).filter(([k]) => k === "hidden")).toHaveLength(3);
    expect(fixes(text)).toEqual([]);
  });

  it("leave a negative without a suggestion where the positive word won't fit", () => {
    const text = "You do not have to go. She does not have any. It does not have a menu.";
    expect(found(text)).toEqual([
      ["negative", "do not have"],
      ["negative", "does not have"],
      ["negative", "does not have"],
    ]);
    expect(checkPage(text).issues.map((i) => [i.note, i.fix])).toEqual([
      ["Negative. Say what is, not what isn't.", undefined],
      ["Negative. Say what is, not what isn't.", undefined],
      ["Negative. Try “lacks”.", "lacks"],
    ]);
  });

  it("leave of course out of a hidden action, as a filler of its own", () => {
    const text = "He made a decision of course.";
    expect(fixes(text)).toEqual([["made a decision", "decided"]]);
    expect(found(text, ["filler"])).toEqual([["filler", "of course"]]);
  });

  it("keep a negative's suggestion before to, unless the negative is have", () => {
    expect(fixes("It is not possible to go. He did not remember to call.")).toEqual([
      ["not possible", "impossible"],
      ["did not remember", "forgot"],
    ]);
  });

  it("take in the of after a hidden action, so the verb reads right", () => {
    expect(fixes("They carried out a review of the code. We conducted an analysis of the data. We made use of it.")).toEqual([
      ["carried out a review of", "reviewed"],
      ["conducted an analysis of", "analyzed"],
      ["made use of", "used"],
    ]);
  });

  it("offer more only where no word before it asks for a noun, and many where one may", () => {
    expect(fixes("His additional work. The additional cost. The numerous reasons. A numerous crowd.")).toEqual([
      ["numerous", "many"],
    ]);
  });

  it("offer no simpler word that breaks the words around it", () => {
    const text = "We paid an additional fee. It needs additional work. I do not often see him. It is not often that we win. We are not often late.";
    expect(found(text, ["simpler"])).toHaveLength(5);
    expect(fixes(text)).toEqual([
      ["additional", "more"],
      ["not often", "rarely"],
    ]);
  });

  it("keep the of of a phrase like a majority of before the, them, and words like them", () => {
    const text = "A majority of the members voted. A number of them left. A majority of voters agreed. We met a number of his friends.";
    expect(fixes(text)).toEqual([
      ["A majority of", "Most of"],
      ["A number of", "Some of"],
      ["A majority of", "Most"],
      ["a number of", "some of"],
    ]);
    expect(checkPage(text).issues[0].note).toBe("Simpler: Most of.");
  });

  it("follow the spelling rules for a verb's forms, and the person of each form of be", () => {
    expect(fixes("He walked quickly home.")).toEqual([["walked quickly", "hurried"]]);
    expect(fixes("I am in agreement with you. Being in agreement with them helps.")).toEqual([
      ["am in agreement with", "agree with"],
      ["Being in agreement with", "Agreeing with"],
    ]);
    // "Has been able to" would need a participle of "can", which doesn't exist.
    expect(fixes("She has been able to swim.")).toEqual([]);
  });

  it("start a suggestion with a capital where the marked text does", () => {
    expect(fixes("Utilize it. Not many came. Made a decision.")).toEqual([
      ["Utilize", "Use"],
      ["Not many", "Few"],
      ["Made a decision", "Decided"],
    ]);
  });

  it("put the suggestion in the note, and keep negatives as they are", () => {
    const text = "We made a decision. It does not have one.";
    expect(checkPage(text).issues.map((i) => [i.note, i.fix])).toEqual([
      ["Hidden action. Try “decided”.", "decided"],
      ["Negative. Try “lacks”.", "lacks"],
    ]);
  });
});

describe("what counts as prose", () => {
  it("skips headings, code, link addresses, and list markers", () => {
    const text = [
      "# A heading that really is very long and would otherwise be very hard to read for sure",
      "",
      "Some text with `code that really is very long` here.",
      "",
      "- A list item that really matters.",
      "- Read [the docs](https://example.com/really-very-long-url) today.",
      "",
      "```js",
      "const x = really();",
      "```",
      "",
    ].join("\n");
    const report = checkPage(text);
    const item = text.indexOf("really matters");
    expect(report.issues).toEqual([
      { from: item, to: item + 6, kind: "intensifier", note: "Intensifier. It rarely adds strength." },
      { from: item, to: item + 6, kind: "adverb", note: "Adverb. Cut it if the sentence holds without it." },
    ]);
    // "Some text with here." "A list item that really matters." "Read the docs today."
    expect(report).toMatchObject({ sentences: 3, words: 14 });
  });

  it("skips tables, HTML, bare addresses, indented code, and underlined headings", () => {
    const text = [
      "| really quickly |",
      "<div>really quickly</div>",
      "",
      "See https://example.com/really/quickly now.",
      "",
      "    really quickly indented code",
      "",
      "A title that really reads quickly",
      "===",
      "",
      "Another title, really",
      "---",
      "",
      "- An item",
      "",
      "    really part of the item.",
      "",
    ].join("\n");
    expect(found(text)).toEqual([
      ["intensifier", "really"],
      ["adverb", "really"],
    ]);
    expect(checkPage(text).issues[0].from).toBe(text.indexOf("really part"));
  });

  it("skips HTML blocks and comments that run over several lines", () => {
    const text = [
      "<!--",
      "really quickly in a comment",
      "-->",
      "",
      "<div>",
      "really quickly in a block",
      "</div>",
      "",
      "<details>",
      "<summary>A really quick summary</summary>",
      "really quickly in the details",
      "",
      "<pre>",
      "really quickly",
      "",
      "still really preformatted",
      "</pre>",
      "",
      "Back to really plain prose.",
      "",
    ].join("\n");
    expect(found(text)).toEqual([
      ["intensifier", "really"],
      ["adverb", "really"],
    ]);
    expect(checkPage(text).issues[0].from).toBe(text.indexOf("really plain"));
  });

  it("keeps prose that only looks like code or an underlined heading", () => {
    const really = [
      ["intensifier", "really"],
      ["adverb", "really"],
    ];
    expect(found("- really quickly\n---")).toEqual([...really, ["adverb", "quickly"]]);
    expect(found("First line of it\n    really continues.")).toEqual(really);
    expect(found("- An item\n\n    Its first part.\n\n    really its second part.")).toEqual(really);
    expect(found("I wrote this really quickly.\n> A quote, really.\n---")).toEqual([...really, ["adverb", "quickly"], ...really]);
  });

  it("reads indented text as code once a heading ends the list", () => {
    expect(found("- Install it.\n\n## Usage\n\n    really quickly run it")).toEqual([]);
  });

  it("never runs a sentence from one list item into the next", () => {
    expect(found(`- ${HARD.slice(0, 60)}\n- ${HARD.slice(60)}`, ["hard", "veryHard"])).toEqual([]);
  });

  it("gives the same answer for a paragraph it has seen before", () => {
    const { checkPage } = createChecker();
    const text = `${HARD}\n\n${HARD}\n`;
    const report = checkPage(text);
    expect(report.issues.map((i) => [i.from, i.to])).toEqual([
      [0, HARD.length],
      [HARD.length + 2, 2 * HARD.length + 2],
    ]);
    expect(checkPage(text)).toEqual(report);
  });
});

describe("dashes", () => {
  const dashes = (text: string, check = checkPage) =>
    check(text)
      .issues.filter((i) => i.kind === "dash" || i.kind === "dashStyle")
      .map((i) => [i.kind, text.slice(i.from, i.to), i.note, i.fix]);
  const ANOTHER = "Another dash in this paragraph.";

  it("leave a paragraph's first use alone, and mark each use after it", () => {
    expect(dashes("My plan — bold as ever — failed. It was late — very late. We left — fast.")).toEqual([
      ["dash", "— very late.", ANOTHER, undefined],
      ["dash", "— fast.", ANOTHER, undefined],
    ]);
    // A pair is one use: the aside between its dashes.
    expect(dashes("It was late — very late. My plan — bold as ever — failed.")).toEqual([
      ["dash", "— bold as ever —", "Another pair of dashes in this paragraph.", undefined],
    ]);
    // A third dash in one sentence is a second use.
    expect(dashes("A plan — bold as ever — failed — at once.")).toEqual([["dash", "— at once.", ANOTHER, undefined]]);
    // Spaced en dashes count too, and so does one with a number on one side only.
    expect(dashes("It was late – very late. We had 5 – the rest left.")).toEqual([["dash", "– the rest left.", ANOTHER, undefined]]);
  });

  it("end a single dash's mark at its line", () => {
    expect(dashes("It was late — very late. We left —\nfast, and slept.")).toEqual([["dash", "—", ANOTHER, undefined]]);
  });

  it("start again in each paragraph", () => {
    expect(dashes("One — two.\n\nThree — four.\n\n- An item — here.\n- Another — there.")).toEqual([]);
  });

  it("leave ranges, hyphens, closed en dashes, and a run of dashes alone", () => {
    expect(dashes("Pages 10–20, a well-known fact, the Paris–London train, and one — dash. And 1990 – 1995.")).toEqual([]);
    expect(dashes("Mrs. C—— came. It was late — very late.")).toEqual([]);
    // Days, hours, money, and decades make ranges too, so they set no style.
    expect(dashes("Open Monday – Friday, 9am – 5pm, for $5 – $10, in the 1990s – 2000s.\n\nIt was late—very late.")).toEqual([]);
  });

  it("leave attributions, dashes that start a line, and cut-off speech alone", () => {
    expect(dashes("> The best. — Red Smith\n> — Someone else.")).toEqual([]);
    expect(dashes("— apples\n— plums\n— pears")).toEqual([]);
    expect(dashes("“I—I—it's fine.” He paused. “But—” She left. “—and then?”")).toEqual([]);
    expect(dashes("It was late — very late. We said no—no.")).toEqual([]);
    expect(dashes("It was late — very late. And then—")).toEqual([]);
    // An attribution after a quote's last sentence.
    expect(dashes("> It was late — very late. Write daily. — Red Smith")).toEqual([]);
    // A straight quote closes after a word: "go"—and is a dash.
    expect(dashes('It was late — very late. We said "go"—and went.')).toEqual([["dash", '—and went.', ANOTHER, undefined]]);
  });

  it("mark a dash in the page's less common style, with the page's style as its fix", () => {
    expect(dashes("One — two.\n\nThree — four.\n\nFive—six.")).toEqual([
      ["dashStyle", "Five—six.", "This page spaces its dashes: “word — word”.", "Five — six."],
    ]);
    expect(dashes("One—two.\n\nThree—four.\n\nFive — six.")).toEqual([
      ["dashStyle", "Five — six.", "This page writes its dashes closed up: “word—word”.", "Five—six."],
    ]);
    expect(dashes("One – two.\n\nThree – four.\n\nFive — six.")).toEqual([
      ["dashStyle", "Five — six.", "This page uses spaced en dashes: “word – word”.", "Five – six."],
    ]);
    // A spaced pair on a closed page is one mark, with one fix.
    expect(dashes("One—two.\n\nThree—four.\n\nA plan — bold — failed.")).toEqual([
      ["dashStyle", "plan — bold — failed.", "This page writes its dashes closed up: “word—word”.", "plan—bold—failed."],
    ]);
    // Speech keeps its dashes as written.
    expect(dashes("One — two.\n\nThree — four.\n\n“I—I don't know,” he said. “No—no—no!”")).toEqual([]);
    // A dash beside a quote or bracket, or spaced on one side only, has no style to fix.
    expect(dashes("One — two.\n\nThree — four.\n\nFive — six.\n\n“Wait—” she said.\n\n(No—) he said.\n\nSo —then.")).toEqual([]);
  });

  it("mark a dash once, as a use too many before a style to fix", () => {
    expect(dashes("One — two.\n\nThree — four.\n\nIt was late — very late. Five—six.")).toEqual([
      ["dash", "—six.", ANOTHER, undefined],
    ]);
  });

  it("read a dash beside a link, an address, or code as no style, and keep the markup", () => {
    expect(dashes("One—two.\n\nThree—four.\n\nSee [Five](http://a.com) — six.\n\nOr `x` — y.\n\nOr http://a.com — z.")).toEqual([]);
  });

  it("take the page's style from its prose and headings, not from code or ranges", () => {
    expect(dashes("```\na — b — c — d\n```\n\n2019 – 2021. 2021 – 2023.\n\nOne—two.")).toEqual([]);
    expect(dashes("# One — two\n\n## Three — four\n\nFive—six.")).toEqual([
      ["dashStyle", "Five—six.", "This page spaces its dashes: “word — word”.", "Five — six."],
    ]);
  });

  it("follow the page's style as it changes", () => {
    // One checker, as the editor has: a paragraph it has seen in one style is checked again in another.
    const { checkPage: check } = createChecker();
    expect(dashes("One—two.\n\nFive — six.", check)).toEqual([
      ["dashStyle", "Five — six.", "This page writes its dashes closed up: “word—word”.", "Five—six."],
    ]);
    expect(dashes("One — two.\n\nThree — four.\n\nFive — six.", check)).toEqual([]);
  });

  it("count neither kind as a weakener", () => {
    expect(checkPage("It was late — very late. We left — fast.").weakeners).toBe(1);
  });
});

describe("speed", () => {
  // Each dash is read from the few characters around it. Reading the rest of the page for each one
  // took 2.4 s per edit on this page; the bound is loose, for slow machines.
  it("checks a long page full of dashes in well under a second per edit", () => {
    const para = "It was late — very late, and we left — fast. The plan — bold as ever — failed. ";
    const page = Array.from({ length: 160 }, (_, i) => `${i} ${para.repeat(4)}`).join("\n\n");
    const { checkPage } = createChecker();
    checkPage(page);
    const start = performance.now();
    checkPage(page.replace("0 It", "0 Its"));
    expect(performance.now() - start).toBeLessThan(300);
  });
});
