import { describe, expect, it } from "vitest";
import { checkPunctuation, dashStyle, punctuationIn, SKIPPED } from "./punctuation";

/** The marked text, its note, and its fix, for one block in the closed dash style. */
const marks = (text: string, style: Parameters<typeof punctuationIn>[1] = "closed") =>
  punctuationIn(text, style).map((m) => [text.slice(m.from, m.to), m.note, m.fix]);

describe("punctuation", () => {
  it("finds a space before punctuation", () => {
    expect(marks("He said , then left .")).toEqual([
      ["said ,", "A space before the comma.", "said,"],
      ["left .", "A space before the period.", "left."],
    ]);
    expect(marks("Why ?! Fine ; go : now !")).toEqual([
      ["Why ?!", "A space before the question mark.", "Why?!"],
      ["Fine ;", "A space before the semicolon.", "Fine;"],
      ["go :", "A space before the colon.", "go:"],
      ["now !", "A space before the exclamation mark.", "now!"],
    ]);
    // An ellipsis, spaced or not, a decimal, a smiley, a ratio, and a file type stay.
    expect(marks("Wait ... what? He paused . . . and went. It costs .5 now. Nice :) A 3 : 2 split. Open .md files.")).toEqual([]);
    // Before a closing quote or a tab, too, and a doubled comma goes with the space.
    expect(marks("He said ,” and left. She said\t, ok. He said ,, then.")).toEqual([
      ["said ,", "A space before the comma.", "said,"],
      ["said\t,", "A space before the comma.", "said,"],
      ["said ,,", "A space before the comma.", "said,"],
    ]);
    // A space before a period after a bracket marks the period; its bracket waits for the fix.
    expect(marks("Then it rained) .")).toEqual([["rained) .", "A space before the period.", "rained)."]]);
  });

  it("finds no space after a comma, a semicolon, or the end of a sentence", () => {
    expect(marks("Red,green and blue;white. It was fine.Then we left!Now go?Yes.")).toEqual([
      ["Red,green", "No space after the comma.", "Red, green"],
      ["blue;white.", "No space after the semicolon.", "blue; white."],
      ["fine.Then", "No space after the period.", "fine. Then"],
      ["left!Now", "No space after the exclamation mark.", "left! Now"],
      ["go?Yes.", "No space after the question mark.", "go? Yes."],
    ]);
    // Numbers, abbreviations, names, file names, addresses, and handles stay.
    expect(marks("It cost 1,000 or 2;3. See e.g.The list, the U.S.Army, Node.js, and a.b. Mail me@x.Org or x.com/a,b now.")).toEqual([]);
    expect(marks("Mail me@site.Com, user@host,com, a=b,c, key:val,x, and #tag,y now.")).toEqual([]);
    // A capital alone after the stop may be "I", and a name in two capitals may be code.
    expect(marks("It was fine.I left. Call Console.WriteLine here.")).toEqual([]);
  });

  it("finds doubled punctuation, but not an ellipsis", () => {
    expect(marks("Yes,, we did.. And then;; we left... See ../docs.")).toEqual([
      ["Yes,,", "Two commas.", "Yes,"],
      ["did..", "Two periods.", "did."],
      ["then;;", "Two semicolons.", "then;"],
    ]);
    expect(marks("Wait,,, what;;; now. Count 1..10 here.")).toEqual([]);
  });

  it("finds a doubled word, but not one doubled on purpose", () => {
    expect(marks("We saw the the cat. The the dog ran. It went WENT away.")).toEqual([
      ["the the", "The same word twice.", "the"],
      ["The the", "The same word twice.", "The"],
      ["went WENT", "The same word twice.", "went"],
    ]);
    expect(marks("She had had enough. I knew that that was it. Bye bye. We flew to Bora Bora. The cat, cat food.")).toEqual([]);
    expect(marks("It was so so good. I gave her her book. What it was was odd. A long long time. It is much much better.")).toEqual([]);
    expect(marks("Yada yada, wink wink.")).toEqual([]);
  });

  it("finds hyphens for a dash, and writes the dash in the page's style", () => {
    expect(marks("It was late--very late. It was late -- very late. It was late - very late.")).toEqual([
      ["late--very", "Two hyphens for a dash.", "late—very"],
      ["late -- very", "Two hyphens for a dash.", "late—very"],
      ["late - very", "A hyphen for a dash.", "late—very"],
    ]);
    expect(marks("It was late -- very late.", "spaced")).toEqual([["late -- very", "Two hyphens for a dash.", "late — very"]]);
    expect(marks("It was late - very late.", "spacedEn")).toEqual([["late - very", "A hyphen for a dash.", "late – very"]]);
    // A dash that ends a sentence, as when speech breaks off.
    expect(marks("“I was going to--” She stopped. I was going to --", "spaced")).toEqual([
      ["to--", "Two hyphens for a dash.", "to —"],
      ["to --", "Two hyphens for a dash.", "to —"],
    ]);
    // At a line break, or a closing quote: the dash has nothing after it.
    expect(marks("I was going to--\nShe stopped. \"I was going to--\" she said. (Or so--) he said.", "spaced")).toEqual([
      ["to--", "Two hyphens for a dash.", "to —"],
      ["to--", "Two hyphens for a dash.", "to —"],
      ["so--", "Two hyphens for a dash.", "so —"],
    ]);
    // An opening quote after the dash belongs to the next word.
    expect(marks('He said - "yes" now.', "spaced")).toEqual([['said - "yes"', "A hyphen for a dash.", 'said — "yes"']]);
    // Two hyphens between numbers make a range.
    expect(marks("It ran 1990--1995, on pages 10 -- 20.")).toEqual([
      ["1990--1995,", "Two hyphens for a range.", "1990–1995,"],
      ["10 -- 20.", "Two hyphens for a range.", "10–20."],
    ]);
    // A rule, an option, a sum, a range, hours, days, an arrow, and a hyphenated word stay.
    expect(marks("--- Run it with --verbose. 5 - 3 is 2. Pages 10-20. Open 9am - 5pm, Monday - Friday. A well-known fact.")).toEqual([]);
    expect(marks("Open (Monday - Friday), “Mon - Fri”, noon - 2pm, 2019 - present. Pick File --> Save, or <-- back.")).toEqual([]);
    expect(marks("--verbose turns on logs.")).toEqual([]);
  });

  it("finds a hyphen after an -ly adverb, but not after other -ly words", () => {
    expect(marks("A highly-rated, newly-built and fully-fledged plan.")).toEqual([
      ["highly-rated", "A hyphen after an -ly adverb.", "highly rated"],
      ["newly-built", "A hyphen after an -ly adverb.", "newly built"],
      ["fully-fledged", "A hyphen after an -ly adverb.", "fully fledged"],
    ]);
    expect(marks("A family-owned, early-stage, friendly-looking, scholarly-minded firm. Shelly-Ann ran. A sly-looking fox.")).toEqual([]);
    expect(marks("It went willy-nilly, roly-poly, hurly-burly. A steely-eyed, gravelly-voiced, ghastly-looking, spindly-legged man. A ‘highly-rated’ plan.")).toEqual([
      ["highly-rated", "A hyphen after an -ly adverb.", "highly rated"],
    ]);
  });

  it("finds a bracket or curly quote with no partner, without a fix", () => {
    expect(marks("We left (in a hurry.")).toEqual([["(in", "No closing parenthesis.", undefined]]);
    expect(marks("Then it rained) all day.")).toEqual([["rained)", "No opening parenthesis.", undefined]]);
    expect(marks("She said “stop.")).toEqual([["“stop.", "No closing quote.", undefined]]);
    expect(marks("He said go” and left.")).toEqual([["go”", "No opening quote.", undefined]]);
    // Pairs, smileys, and list letters stay.
    expect(marks("We left (in a hurry) at “noon”. Nice :) and sad :( but fine ;) Pick a) one or b) two, or option (c).")).toEqual([]);
    expect(marks("I'm sad :( today.")).toEqual([]);
    expect(marks("Fine =) and :-) ok.")).toEqual([]);
    expect(marks("Sad :-( ok.")).toEqual([]);
    expect(marks("Pick 10) or iii) now.")).toEqual([]);
    // The inner pair closes first, so the outer one is lone.
    expect(marks("We left (in a (big) hurry.")).toEqual([["(in", "No closing parenthesis.", undefined]]);

  });

  it("finds a decade with an apostrophe", () => {
    expect(marks("In the 1990's and the 2000’s it grew. The 1990's best film.")).toEqual([
      ["1990's", "An apostrophe in a plural.", "1990s"],
      ["2000’s", "An apostrophe in a plural.", "2000s"],
      ["1990's", "An apostrophe in a plural.", "1990s"],
    ]);
    expect(marks("In 1990's spring, and the 1995's budget.")).toEqual([]);
  });

  it("reads nothing across skipped text", () => {
    const code = SKIPPED.repeat(6);
    expect(marks(`Run ${code} , then go. The ${code} the cat. It ${code}--${code} works.`)).toEqual([]);
  });
});

describe("the page's dash style", () => {
  it("is the one the page uses most, closed em dashes by default", () => {
    expect(dashStyle("No dashes here.")).toBe("closed");
    expect(dashStyle("One—two. Three — four.")).toBe("closed");
    expect(dashStyle("One — two. Three — four. Five—six.")).toBe("spaced");
    expect(dashStyle("One – two. Three – four. Five — six. Pages 10–20.")).toBe("spacedEn");
    // A tie goes to closed, then to spaced em dashes.
    expect(dashStyle("One — two. Three – four.")).toBe("spaced");
    expect(dashStyle("One—two. Three – four.")).toBe("closed");
  });
});

describe("the page", () => {
  const page = (raw: string) => checkPunctuation(raw, raw).map((m) => [raw.slice(m.from, m.to), m.note, m.fix]);

  it("leaves brackets around code, links, and addresses alone", () => {
    const raw = "It is (named `foo`), (see [the docs](https://x.org)), (see ![a cat](cat.png)), (see <https://x.org>), (`x` and more), (see https://example.com/docs), and (https://example.com/a_(b)).\n";
    expect(page(raw)).toEqual([]);
    // A bare address keeps only the brackets it opens.
    expect(page("Go (see https://example.com/docs now.\n")).toEqual([["(see", "No closing parenthesis.", undefined]]);
  });

  it("skips HTML blocks and comments", () => {
    expect(page("<!--\nTODO , fix it\n-->\n\n<div>\nHe said , ok\n</div>\n\nWe left , then.\n")).toEqual([
      ["left ,", "A space before the comma.", "left,"],
    ]);
  });

  it("takes the page's dash style from its prose, not from code", () => {
    expect(page("```\na — b — c — d\n```\n\nIt was late -- very late.\n")).toEqual([
      ["late -- very", "Two hyphens for a dash.", "late—very"],
    ]);
  });

  it("follows a new dash style in a block it has seen", () => {
    expect(page("It was late -- very late.\n")).toEqual([["late -- very", "Two hyphens for a dash.", "late—very"]]);
    expect(page("One — two. Three — four.\n\nIt was late -- very late.\n")).toEqual([
      ["late -- very", "Two hyphens for a dash.", "late — very"],
    ]);
  });

  it("lets a quote run on into the next paragraph, as fiction does", () => {
    expect(page("“It was late.\n\n“Then it rained.”\n\n“Not closed.\n\nThe end.\n")).toEqual([["“Not", "No closing quote.", undefined]]);
  });

  it("skips code, link addresses, list markers, and ghosts, and checks headings", () => {
    // The ghost "really" is blanked out in `page`, as the editor does.
    const raw = "# A heading ,\n\nRun `npm i` , then [the docs](http://x.org/a,b) , and really , ok.\n\n- an item , here\n";
    const ghost = raw.indexOf("really");
    const page = raw.slice(0, ghost) + "      " + raw.slice(ghost + 6);
    const found = checkPunctuation(page, raw).map((m) => [raw.slice(m.from, m.to), m.note, m.fix]);
    expect(found).toEqual([
      ["heading ,", "A space before the comma.", "heading,"],
      ["item ,", "A space before the comma.", "item,"],
    ]);
  });
});
