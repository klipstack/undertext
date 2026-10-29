// Words and phrases that weaken a sentence or have a plainer twin, and the words to use instead.

import { Issue, Kind } from "./issues";

// The weakener lists follow what Hemingway's web editor marked on test sentences, in October 2026,
// and add the clutter William Zinsser names in "On Writing Well". They are short on purpose: a mark
// that is often wrong teaches you to ignore the marks.

/** Matches any of the phrases as whole words, in any case. A space matches any run of space. */
const phrases = (list: string[]) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}'’-])(?:${list
      .sort((a, b) => b.length - a.length)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+").replace(/'/g, "['’]"))
      .join("|")})(?![\\p{L}\\p{N}'’-])`,
    "giu",
  );

/** The form a phrase is listed under: lower case, single spaces, straight apostrophes. */
const key = (match: string) => match.toLowerCase().replace(/\s+/g, " ").replace(/’/g, "'");

const QUALIFIERS = phrases(["I think", "I believe", "I feel", "in my opinion", "maybe", "perhaps", "possibly", "just"]);

const INTENSIFIERS = phrases([
  "very", "really", "extremely", "totally", "absolutely", "completely", "incredibly", "utterly", "entirely",
  "remarkably", "exceptionally", "hugely",
]);

const FILLERS = phrases([
  "basically", "essentially", "of course", "needless to say", "it goes without saying", "it is worth noting",
  "it should be noted", "it is important to note", "I might add", "it is interesting to note", "it should be pointed out",
]);

/** Word or phrase → the plainer one. A single word also matches its -s, -ed, and -ing forms. */
const SIMPLER: Record<string, string> = {
  "a majority of": "most", "a number of": "some", accomplish: "do", acquire: "get", additional: "more",
  adequate: "enough", anticipate: "expect", approximately: "about", ascertain: "find out", assist: "help",
  assistance: "help", "at this point in time": "now", attempt: "try", beneficial: "helpful", commence: "start",
  component: "part", consequently: "so", construct: "build", demonstrate: "show", "due to the fact that": "because",
  eliminate: "cut", endeavor: "try", expedite: "speed up", facilitate: "help", finalize: "finish", frequently: "often",
  "in order to": "to", "in spite of the fact that": "although", "in the event that": "if",
  "in the near future": "soon", indicate: "show", initial: "first", initiate: "start",
  leverage: "use", magnitude: "size", methodology: "method", modify: "change", "not many": "few", "not often": "rarely",
  numerous: "many", objective: "aim", obtain: "get", "on a daily basis": "daily", optimal: "best",
  participate: "take part", portion: "part",
  possess: "have", "prior to": "before", purchase: "buy", regarding: "about", remainder: "rest", retain: "keep",
  "subsequent to": "after", subsequently: "later", sufficient: "enough", terminate: "end", transmit: "send",
  utilise: "use", utilization: "use", utilize: "use", "with regard to": "about", "with respect to": "about",
  // Zinsser's clutter.
  "a personal friend of mine": "my friend", "at an early date": "soon", "at the present time": "now", "by means of": "by",
  currently: "now", "despite the fact that": "although", "during the course of": "during", "except for the fact that": "except that",
  "for the purpose of": "for", "for the reason that": "because", "i personally": "I", "in a timely manner": "promptly",
  "in close proximity to": "near", "in excess of": "more than", "in light of the fact that": "because",
  "in reference to": "about", "in the vicinity of": "near", "in view of the fact that": "because",
  "on a regular basis": "regularly", "on the grounds that": "because", "owing to the fact that": "because",
  "referred to as": "called", "regardless of the fact that": "although", "the question as to whether": "whether",
  "until such time as": "until", "with reference to": "about", "with the exception of": "except",
  "with the possible exception of": "except",
};

/** Verbs whose forms don't follow the rules in `verbForms`: -s, past, -ing, and past participle. */
const IRREGULAR_VERBS: Record<string, string> = {
  agree: "agrees agreed agreeing agreed", bite: "bites bit biting bitten", build: "builds built building built", buy: "buys bought buying bought",
  choose: "chooses chose choosing chosen", come: "comes came coming come", creep: "creeps crept creeping crept",
  cut: "cuts cut cutting cut", do: "does did doing done", drink: "drinks drank drinking drunk",
  eat: "eats ate eating eaten", find: "finds found finding found", get: "gets got getting gotten",
  give: "gives gave giving given", go: "goes went going gone", have: "has had having had", hit: "hits hit hitting hit",
  keep: "keeps kept keeping kept",
  know: "knows knew knowing known", make: "makes made making made", pay: "pays paid paying paid",
  run: "runs ran running run", say: "says said saying said", send: "sends sent sending sent",
  show: "shows showed showing shown", slam: "slams slammed slamming slammed", snap: "snaps snapped snapping snapped",
  speak: "speaks spoke speaking spoken", speed: "speeds sped speeding sped", take: "takes took taking taken",
  think: "thinks thought thinking thought", tiptoe: "tiptoes tiptoed tiptoeing tiptoed", tread: "treads trod treading trodden",
};

/** A verb's base, -s, past, -ing, and past participle forms. */
function verbForms(base: string): string[] {
  const irregular = IRREGULAR_VERBS[base];
  if (irregular) return [base, ...irregular.split(" ")];
  const y = /[^aeiou]y$/.test(base) ? base.slice(0, -1) : null;
  const s = y ? `${y}ies` : /(?:s|x|z|ch|sh)$/.test(base) ? `${base}es` : `${base}s`;
  const past = y ? `${y}ied` : base.endsWith("e") ? `${base}d` : `${base}ed`;
  const ing = /[^e]e$/.test(base) ? `${base.slice(0, -1)}ing` : `${base}ing`;
  return [base, s, past, ing, past];
}

/**
 * What a verb form can be. "Present" is "am" and "are"; "inf" is "be", as after "will". A plain
 * base form is either.
 */
type Role = "base" | "present" | "inf" | "s" | "past" | "ing" | "pp";
const FORM_ROLES: Role[] = ["base", "s", "past", "ing", "pp"];
const BE_ROLES: Record<string, Role> = { am: "present", is: "s", are: "present", was: "past", were: "past", be: "inf", been: "pp", being: "ing" };
const BE = Object.keys(BE_ROLES);

/** A phrase's plainer words, and what form the phrase's verb can be. */
interface Swap {
  plain: string;
  roles: Role[];
}
const addSwap = (map: Map<string, Swap>, phrase: string, plain: string, role: Role) => {
  const swap = map.get(phrase);
  if (swap) swap.roles.push(role);
  else map.set(phrase, { plain, roles: [role] });
};

/** Helper verbs a participle follows, as in "has made" or "was acquired", and contractions of them. */
const PERFECT = /^(?:has|have|had|having|am|is|are|was|were|be|been|being)$|.['’](?:s|ve|d|re|m)$/iu;
/** Words a plain infinitive follows, as in "will make", and "we'll make". */
const MODAL = /^(?:to|will|would|can|cannot|could|may|might|must|shall|should|do|does|did|wo|ca|sha)$|.['’]ll$/iu;
/** Words that can stand between a helper verb and its verb, as in "has not made" or "has finally made". */
const BETWEEN = new Set(["not", "never", "already", "also", "always", "just", "ever", "still"]);
const PRONOUNS = new Set(["i", "you", "he", "she", "it", "we", "they"]);

/**
 * Whether `before` ends with a helper verb that `helper` matches, maybe with "n't", maybe then one
 * word: "not", an adverb, or, in a question that starts with the helper, its subject ("Has she").
 */
function endsWithHelper(before: string, helper: RegExp): boolean {
  if (!/\s$/.test(before)) return false;
  const words = [...before.matchAll(/[\p{L}'’]+/gu)];
  const end = (m: RegExpMatchArray) => m.index! + m[0].length;
  const is = (m: RegExpMatchArray | undefined) => !!m && helper.test(m[0].replace(/n['’]t$/iu, ""));
  const last = words[words.length - 1];
  if (!last || before.slice(end(last)).trim()) return false;
  if (is(last)) return true;
  const prev = words[words.length - 2];
  if (!prev || before.slice(end(prev), last.index).trim() || !is(prev)) return false;
  const word = last[0].toLowerCase();
  if (BETWEEN.has(word) || (word.endsWith("ly") && !LY_WORDS.has(word))) return true;
  return PRONOUNS.has(word) && /(?:^|[.!?]["'”’)]*\s+)$/u.test(before.slice(0, prev.index));
}

/** The form the matched verb has here, from the words before it. A form listed as past comes before its participle. */
function roleHere(roles: Role[], before: string): Role {
  if (roles.includes("pp") && endsWithHelper(before, PERFECT)) return "pp";
  if (roles.includes("base") && endsWithHelper(before, MODAL)) return "inf";
  return roles[0];
}

/** The plainer words in a form. Null where "can" has no such form, as in "will can". */
function inflect(plain: string, role: Role): string | null {
  const [verb, ...rest] = plain.split(" ");
  const tail = rest.length ? ` ${rest.join(" ")}` : "";
  if (verb === "can") {
    const modal = { present: "can", s: "can", base: "can", past: "could" }[role as string];
    return modal ? modal + tail : null;
  }
  const f = verbForms(verb);
  return { base: f[0], present: f[0], inf: f[0], s: f[1], past: f[2], ing: f[3], pp: f[4] }[role] + tail;
}

// Weak verbs: a plain verb and an adverb that one stronger verb replaces, as in "walked slowly".
const WEAK_PAIRS =
  "run quickly: sprint, walk quickly: hurry, walk slowly: stroll, walk quietly: tiptoe, walk carefully: tread, " +
  "eat quickly: gobble, move quickly: rush, move slowly: creep, look quickly: glance, look angrily: glare, " +
  "drink quickly: gulp, say loudly: shout, say softly: murmur, say quietly: whisper, say angrily: snap, " +
  "speak loudly: shout, speak softly: whisper, speak quietly: whisper, talk loudly: shout, talk quietly: whisper, " +
  "close loudly: slam, laugh loudly: guffaw, laugh quietly: chuckle";
/** "walked slowly" → "stroll", put in the same form where it's marked. */
const WEAK_VERB_FORMS = new Map<string, Swap>();
for (const pair of WEAK_PAIRS.split(", ")) {
  const [, verb, adverb, stronger] = pair.match(/^(\S+) (\S+): (\S+)$/)!;
  verbForms(verb).forEach((form, i) => addSwap(WEAK_VERB_FORMS, `${form} ${adverb}`, stronger, FORM_ROLES[i]));
}
const WEAK_VERBS = phrases([...WEAK_VERB_FORMS.keys()]);

// Hidden actions: a verb and a noun that hide a plainer verb, as in "made a decision".
const HIDDEN_ACTIONS =
  "make a decision: decide, reach a decision: decide, reach an agreement: agree, reach a conclusion: conclude, " +
  "come to a conclusion: conclude, give consideration to: consider, take into consideration: consider, " +
  "conduct an analysis: analyze, perform an analysis: analyze, make a recommendation: recommend, " +
  "make a suggestion: suggest, make a payment: pay, make use of: use, make a choice: choose, take action: act, " +
  "have the ability to: can, be able to: can, be in agreement with: agree with, have knowledge of: know, " +
  "make an announcement: announce, carry out a review: review, be dependent on: depend on, " +
  "be indicative of: indicate";
const HIDDEN_FORMS = new Map<string, Swap>();
for (const action of HIDDEN_ACTIONS.split(", ")) {
  const [, verb, rest, plain] = action.match(/^(\S+) (.+): (.+)$/)!;
  if (verb === "be") for (const form of BE) addSwap(HIDDEN_FORMS, `${form} ${rest}`, plain, BE_ROLES[form]);
  else verbForms(verb).forEach((form, i) => addSwap(HIDDEN_FORMS, `${form} ${rest}`, plain, FORM_ROLES[i]));
}
const HIDDEN = phrases([...HIDDEN_FORMS.keys()]);

// Negatives that one positive word says: "does not have" → "lacks".
const NEGATED_VERBS: Record<string, string> = {
  have: "lacks lack lacked", include: "excludes exclude excluded", remember: "forgets forget forgot",
  accept: "rejects reject rejected", succeed: "fails fail failed", notice: "overlooks overlook overlooked",
  agree: "disagrees disagree disagreed", "pay attention to": "ignores ignore ignored",
};
const NEGATIVE_FORMS = new Map([
  ["not able to", "unable to"],
  ["not possible", "impossible"],
  ["not certain", "uncertain"],
  ["not honest", "dishonest"],
  ["not unlike", "like"],
]);
for (const [verb, plain] of Object.entries(NEGATED_VERBS)) {
  const [does, doBase, did] = plain.split(" ");
  for (const [aux, word] of [["does", does], ["do", doBase], ["did", did]]) {
    NEGATIVE_FORMS.set(`${aux} not ${verb}`, word);
    NEGATIVE_FORMS.set(`${aux}n't ${verb}`, word);
  }
}
const NEGATIVE = phrases([...NEGATIVE_FORMS.keys()]);

// Redundant pairs: one word already says what the other adds, as in "end result". The fix keeps it.
/** An adjective its noun already says. The noun may be plural: "free gifts" → "gifts". */
const REDUNDANT_NOUNS =
  "absolute guarantee, added bonus, advance planning, advance warning, basic fundamental, brief summary, " +
  "close proximity, end result, final outcome, free gift, future plan, general consensus, new innovation, " +
  "past experience, past history, personal friend, sum total, true fact, unexpected surprise";
/** A verb and a word its meaning holds, in any tense: "reverted back" → "reverted". */
const REDUNDANT_VERBS =
  "blare loudly, collaborate together, combine together, cooperate together, gather together, join together, " +
  "merge together, postpone until later, repeat again, return back, revert back, scream loudly, shout loudly, " +
  "whisper quietly, whisper softly";
/** Other phrases, and the word that says them. */
const REDUNDANT_PHRASES: Record<string, string> = {
  "absolutely essential": "essential", "atm machine": "ATM", "atm machines": "ATMs", "completely finished": "finished",
  "completely unique": "unique", "consensus of opinion": "consensus", "each and every": "every", "first and foremost": "first",
  "pin number": "PIN", "pin numbers": "PINs", "quite unique": "unique", "totally flabbergasted": "flabbergasted",
  "totally unique": "unique", "very unique": "unique",
};
const REDUNDANT_FORMS = new Map(Object.entries(REDUNDANT_PHRASES));
for (const pair of REDUNDANT_NOUNS.split(", ")) {
  const [adjective, noun] = pair.split(" ");
  const plural = /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
  REDUNDANT_FORMS.set(pair, noun).set(`${adjective} ${plural}`, plural);
}
for (const pair of REDUNDANT_VERBS.split(", ")) {
  const [verb, rest] = pair.split(/ (.+)/);
  for (const form of verbForms(verb)) REDUNDANT_FORMS.set(`${form} ${rest}`, form);
}
const REDUNDANT = phrases([...REDUNDANT_FORMS.keys()]);

// Clichés: phrases worn so smooth they no longer say much. Only ones rarely meant literally.
/** Phrases that start with a verb, in any tense. */
const CLICHE_VERBS =
  "bite the bullet, go the extra mile, hit the ground running, jump on the bandwagon, level the playing field, " +
  "move the needle, open a can of worms, raise the bar, take it to the next level, think outside the box, touch base";
const CLICHES = phrases([
  "a perfect storm", "a win-win", "all walks of life", "at the end of the day", "back to square one",
  "better late than never", "few and far between", "food for thought", "game changer", "game changers", "game-changer",
  "game-changers", "in this day and age", "it is what it is", "last but not least", "level playing field",
  "like the plague", "low hanging fruit", "low-hanging fruit", "needle in a haystack", "only time will tell",
  "par for the course", "paradigm shift", "since the dawn of time", "the best of both worlds",
  "the calm before the storm", "the elephant in the room", "the tip of the iceberg", "the writing on the wall",
  "when all is said and done",
  ...CLICHE_VERBS.split(", ").flatMap((phrase) => {
    const [verb, rest] = phrase.split(/ (.+)/);
    return verbForms(verb).map((form) => `${form} ${rest}`);
  }),
]);

/** "However," at the start of a sentence, where "But" says it plainly. */
const HOWEVER = /(?<=(?:^|[.!?]["'”’)\]*_]*\s)\s*)However,/g;

/** A word's forms and what each can be, and some that don't exist, which never match. */
function forms(word: string): [string, Role[]][] {
  if (word.includes(" ")) return [[word, ["base"]]];
  const ed: Role[] = ["past", "pp"];
  if (word.endsWith("e")) return [[word, ["base"]], [`${word}s`, ["s"]], [`${word}d`, ed], [`${word.slice(0, -1)}ing`, ["ing"]]];
  if (/[^aeiou]y$/.test(word)) {
    const stem = word.slice(0, -1);
    return [[word, ["base"]], [`${stem}ies`, ["s"]], [`${stem}ied`, ed], [`${word}ing`, ["ing"]]];
  }
  const out: [string, Role[]][] = [[word, ["base"]], [`${word}s`, ["s"]], [`${word}es`, ["s"]], [`${word}ed`, ed], [`${word}ing`, ["ing"]]];
  // One vowel before the last consonant may double it: transmit, transmitted.
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(word)) out.push([`${word}${word.at(-1)}ed`, ed], [`${word}${word.at(-1)}ing`, ["ing"]]);
  return out;
}

const SIMPLER_FORMS = new Map<string, Swap>(
  Object.entries(SIMPLER).flatMap(([word, plain]) => forms(word).map(([f, roles]) => [f, { plain, roles }])),
);
const SIMPLER_WORDS = phrases([...SIMPLER_FORMS.keys()]);

const ADVERB = /(?<![\p{L}\p{N}'’-])\p{L}+ly(?![\p{L}\p{N}'’-])/giu;
/** Words that end in -ly but are not adverbs. */
export const LY_WORDS = new Set(
  (
    "only early daily weekly monthly yearly hourly nightly family reply apply supply comply imply rely ally rally " +
    "tally belly bully jelly lily fly butterfly holy ugly silly lonely lovely friendly unfriendly likely unlikely " +
    "elderly costly deadly lively curly oily hilly chilly wily italy july emily kelly sally molly holly assembly " +
    "anomaly monopoly homily folly jolly melancholy"
  ).split(" "),
);
/** Words that end in -ly and aren't marked: not adverbs, or adverbs Hemingway leaves alone. */
const NOT_ADVERBS = new Set([
  ...LY_WORDS,
  ..."usually finally recently rarely generally especially exactly currently actually approximately hardly immediately unfortunately definitely awfully completely".split(
    " ",
  ),
]);

const IRREGULAR =
  "known done made given taken written seen built held told found kept left lost paid said sent shown sold taught " +
  "thought brought bought caught chosen driven eaten fallen forgotten forgiven gotten hidden born borne broken " +
  "beaten begun bitten blown drawn drunk flown frozen grown hung hurt laid led lent meant met put set shut spent " +
  "spoken stolen struck sung thrown torn understood woken won worn bound cast cut felt fought heard hit shaken shot " +
  "sought split spread stuck sworn swept withdrawn mistaken misled misunderstood";
const PASSIVE = new RegExp(
  `(?<![\\p{L}'’-])(?:am|is|are|was|were|be|been|being)\\s+(?:\\p{L}+ly\\s+)?(\\p{L}+ed|${IRREGULAR.replace(/ /g, "|")})(?![\\p{L}'’-])`,
  "giu",
);
/** Words that end in -ed but are not past participles. */
const NOT_PARTICIPLES = new Set(
  "need bed red shed seed feed speed breed greed weed deed creed steed indeed hundred sacred naked wicked rugged ragged".split(" "),
);

const NOTES: Record<"adverb" | "passive" | "qualifier" | "intensifier" | "filler" | "cliche", string> = {
  adverb: "Adverb. Cut it if the sentence holds without it.",
  passive: "Passive voice. Say who does it.",
  qualifier: "Qualifier. It softens the point.",
  intensifier: "Intensifier. It rarely adds strength.",
  filler: "Filler. It adds words, not meaning.",
  cliche: "Cliché. Say it in your own words.",
};

/** Plain words that can't follow a word like "a", "the", "his", or "this". "Many" can follow most of those. */
const DETERMINERS = new Set(["more", "most", "some", "enough"]);
const AFTER_DETERMINER =
  /(?<![\p{L}\p{N}])(?:a|an|the|this|that|these|those|my|your|his|her|its|our|their|each|every|any|no)\s+$/iu;
/** Words that "most" and "some" take "of" before: "most of the members", "some of them". */
const OF_BEFORE = /^\s+(?:the|this|that|these|those|my|your|his|her|its|our|their|them|us|you|it|which|whom|whose)(?![\p{L}\p{N}])/iu;

/** Starts with a capital where the marked text does. */
const matchCase = (fix: string, marked: string) => (/^\p{Lu}/u.test(marked) ? fix[0].toUpperCase() + fix.slice(1) : fix);

/**
 * Marks in one block. Weakeners and simpler words never overlap each other. Adverbs and passive voice
 * may: "really" is an intensifier and an adverb, as Hemingway counts it.
 */
export function wordIssues(text: string): { issues: Issue[]; weakeners: number } {
  const candidates: Issue[] = [];
  type Mark = Pick<Issue, "note" | "fix"> & { to?: number };
  const add = (re: RegExp, kind: Kind, mark: (m: RegExpExecArray) => Mark) => {
    for (const m of text.matchAll(re)) candidates.push({ from: m.index, to: m.index + m[0].length, kind, ...mark(m) });
  };
  const before = (m: RegExpExecArray) => text.slice(Math.max(0, m.index - 40), m.index);
  const after = (m: RegExpExecArray) => text.slice(m.index + m[0].length, m.index + m[0].length + 20);
  /**
   * The plainer words, in the form and case of the marked ones. `fits` says whether they would read
   * right in place; where they wouldn't, the mark stays with the `none` note.
   */
  const swap =
    (map: Map<string, Swap>, note: (fix: string) => string, none: string, fits = (_m: RegExpExecArray, _plain: string) => true) =>
    (m: RegExpExecArray): Mark => {
      const { plain, roles } = map.get(key(m[0]))!;
      const fix = fits(m, plain) ? inflect(plain, roleHere(roles, before(m))) : null;
      return fix === null ? { note: none } : { note: note(matchCase(fix, m[0])), fix: matchCase(fix, m[0]) };
    };
  // Earlier in the list wins when two start at the same place and have the same length.
  add(FILLERS, "filler", () => ({ note: NOTES.filler }));
  add(QUALIFIERS, "qualifier", () => ({ note: NOTES.qualifier }));
  add(INTENSIFIERS, "intensifier", () => ({ note: NOTES.intensifier }));
  const hidden = swap(HIDDEN_FORMS, (fix) => `Hidden action. Try “${fix}”.`, "Hidden action. Use a plain verb.");
  add(HIDDEN, "hidden", (m) => {
    // "Carried out a review of the code": the verb takes the "of" with it, "reviewed the code".
    const of = /^\s+of(?![\p{L}\p{N}])(?!\s+course(?![\p{L}\p{N}]))/u.exec(after(m));
    const mark = hidden(m);
    return of && !/\sof$/i.test(m[0]) && mark.fix ? { ...mark, to: m.index + m[0].length + of[0].length } : mark;
  });
  add(NEGATIVE, "negative", (m) => {
    // "Does not have to go" isn't "lacks to go".
    if (/have$/i.test(m[0]) && /^\s+(?:to|any)(?![\p{L}\p{N}])/u.test(after(m))) return { note: "Negative. Say what is, not what isn't." };
    const fix = matchCase(NEGATIVE_FORMS.get(key(m[0]))!, m[0]);
    return { note: `Negative. Try “${fix}”.`, fix };
  });
  add(WEAK_VERBS, "weakVerb", swap(WEAK_VERB_FORMS, (fix) => `Weak verb. Try “${fix}”.`, "Weak verb. Use one precise verb."));
  add(REDUNDANT, "redundant", (m) => {
    const fix = matchCase(REDUNDANT_FORMS.get(key(m[0]))!, m[0]);
    return { note: `Redundant. Try “${fix}”.`, fix };
  });
  add(CLICHES, "cliche", () => ({ note: NOTES.cliche }));
  add(HOWEVER, "simpler", () => ({ note: "Simpler: But.", fix: "But" }));
  const simpler = swap(SIMPLER_FORMS, (fix) => `Simpler: ${fix}.`, "Simpler word. Reword it plainly.", (m, plain) => {
    // "An additional fee" isn't "an more fee", and "do not often see" isn't "do rarely see".
    if (DETERMINERS.has(plain) && AFTER_DETERMINER.test(before(m))) return false;
    if (plain === "many" && /(?<![\p{L}\p{N}])(?:a|an|each|every)\s+$/iu.test(before(m))) return false;
    if (plain === "rarely" && (/(?<![\p{L}\p{N}])(?:do|does|did)\s+$/iu.test(before(m)) || /^\s+that(?![\p{L}\p{N}])/u.test(after(m)))) return false;
    return true;
  });
  add(SIMPLER_WORDS, "simpler", (m) => {
    const mark = simpler(m);
    // "A majority of the members" is "most of the members": "of" stays before a word like "the".
    if (!mark.fix || !DETERMINERS.has(mark.fix.toLowerCase()) || !/\sof$/i.test(m[0]) || !OF_BEFORE.test(after(m))) return mark;
    const fix = `${mark.fix} of`;
    return { note: `Simpler: ${fix}.`, fix };
  });
  candidates.sort((a, b) => a.from - b.from || b.to - a.to);

  const kept: Issue[] = [];
  for (const c of candidates) {
    const last = kept[kept.length - 1];
    if (!last || c.from >= last.to) kept.push(c);
  }
  const marks = [...kept];
  let shared = 0;
  for (const m of text.matchAll(ADVERB)) {
    if (NOT_ADVERBS.has(m[0].toLowerCase())) continue;
    const holder = marks.find((i) => i.from <= m.index && m.index < i.to);
    // A word with a simpler alternative, or one a redundant pair drops, is marked once, as that.
    if (holder?.kind === "simpler" || holder?.kind === "redundant") continue;
    if (holder) shared++;
    kept.push({ from: m.index, to: m.index + m[0].length, kind: "adverb", note: NOTES.adverb });
  }
  for (const m of text.matchAll(PASSIVE)) {
    if (NOT_PARTICIPLES.has(m[1].toLowerCase())) continue;
    kept.push({ from: m.index, to: m.index + m[0].length, kind: "passive", note: NOTES.passive });
  }
  return { issues: kept, weakeners: kept.filter((i) => i.kind !== "simpler").length - shared };
}
