# Plan: side panels with one job each, and room for Hemingway's checks

Status: phase 1 and most of phase 3 built, 2026-10-26. See "Decisions taken" and "Open decisions"
at the end.

## Goals

- Give each side panel one job, so new features have an obvious home.
- Make room for what [Hemingway Editor](https://hemingwayapp.com) does: readability, highlighted
  issues, and AI rewrites.
- Keep the page calm while writing. Analysis shows only when asked for.
- Every AI result stays a layer: an alternative, a paragraph version, or a Lab mark or cut. The
  one exception is a writing issue's fix: it corrects a mistake in place, and undo brings the old
  words back.

Not in scope: an outline, a file list, more than one open document.

## What Hemingway does

From its help pages, read on 2026-10-26.

- **Readability grade**, top right. The default target is grade 9. Plus can set it to Accessible,
  Default, or Technical.
- **Highlights**, in color, inline:
  - Hard to read (yellow) and very hard to read (red) sentences.
  - Weakeners (blue): adverbs, passive voice, qualifiers, intensifiers, weak verbs, fillers,
    hidden actions, and negative or indirect phrases. Each has its own count and eye.
  - Simpler words (purple): a word with a plainer synonym.
  - Writing issues (green): grammar, spelling, and style, such as a sentence that starts with
    "And". Plus only.
- **A key on the right** with each category's count and an eye icon that shows or hides it.
- **Stats**: words by default. More on request: letters, characters, sentences, paragraphs,
  reading time.
- **Write and Edit modes.** Write hides all highlights and stats. Edit shows them.
- **AI tools** (Plus) on a floating toolbar over a selection: Simplify, Polish, Rephrase, AI
  synonyms, tone (confident, friendly, casual, formal, persuasive), Shorten, Add detail, Add
  headings, bullets, and bold, and a free-text instruction. Results show in a pop-up with "Use
  suggestion", arrows to step through, and "Get another suggestion".
- **Feedback**: a written review of the whole piece. Structure, logic, flow, clarity, tone.

## What Undertext has already

| Hemingway                         | Undertext today                                      |
| --------------------------------- | ---------------------------------------------------- |
| AI synonyms, Rephrase             | Alternatives, and "Suggest other ways" (⌘⇧G)         |
| Shorten it                        | Trims: −10%, −20%, −35%, −50%                        |
| Hard sentences, qualifiers        | Lab checks: long, convoluted, hedges and filler      |
| Grammar and spelling              | "Find writing issues", and spelling as you type      |
| Tone                              | Lab check "Off-tone words" marks words; no rewrite   |
| Use suggestion (replaces text)    | A suggestion becomes an alternative; a mistake's fix replaces it |

The gap is Hemingway's free half: **checks that run locally, as you type**, with no AI call. That
is the grade, hard sentences, adverbs, passive voice, qualifiers, and simpler words. The rest is
mostly here already, in a form that keeps the original.

## The layout before phase 1

- Top bar: word and character count, file name. A click on the count toggles the layers, which
  nothing hints at.
- Left panel: Alternatives (`src/components/AltPanel.tsx`), with Word, Sentence, and Paragraph
  tabs. It follows the caret. ⌘⇧A opens it.
- Right panel: Overflow, a scratch text area for the whole page. ⌘⇧O opens it.
- The Lab (`src/components/LabMenu.tsx`): a floating menu of checks, typo fixes, and trims. ⌘⇧E
  opens it. Results show in a bar under the page (`src/components/LabBar.tsx`).
- Bottom bar: Open and Save on the left. The toast in the middle. Lab, ⌘K, Alternatives, and
  Overflow on the right.

The left panel is about the caret. The right panel is about the page. That split is right, but
nothing says so, and the Lab floats outside it.

## The rule

- **Left panel, "Here": the spot at the caret.** The word, sentence, or paragraph you are on. What
  you can swap in, and why it is marked.
- **Right panel: the whole page.** How it reads, what to check, and the text you set aside.

A new feature goes left if it changes with the caret. It goes right if it is about the whole page.

## Left panel: Here

Today's Alternatives panel, grown. Same shortcut, ⌘⇧A.

- **Alternatives and versions**, as today: Word, Sentence, and Paragraph.
- **Suggest rewrites**: Simplify, Shorter, Polish, Tone (a short list), and a free-text ask.
  Today's "Suggest other ways" becomes one of these.
  - On a word or sentence, each result is a new variant of the alternative.
  - On a whole paragraph, each result is a new paragraph version.
  - ↑↓ steps through results, as today. Nothing is applied until you pick it, and the original
    stays as variant one.
- **Why it's marked**: the reason for the highlight or Lab mark under the caret. For example,
  "Very hard to read. 38 words." Today this is `here` in the Lab bar.

## Right panel: Review and Overflow

One panel, two tabs. ⌘⇧E and ⌘⇧O work the same way. From the page or the other tab, each shows
its tab and focuses it. Pressed inside its own tab, it closes the panel. Esc goes back to the page
and leaves the panel open. A click on a tab in the panel shows that tab. The bottom bar's button,
or the word count for Review, shows the tab, or closes the panel when that tab already shows.

**Review**, top to bottom:

1. **Readability**: the grade, then sentences and reading time. "More" shows letters, characters,
   and paragraphs.
2. **Live checks**: one row per category, with its count and an eye toggle. They update as you
   type. Clicking a row jumps to the next one, like ⌥L.
3. **Ask Claude**: one-shot checks. Weakest sentences, convoluted sentences, off-tone words, hedges
   and filler, writing issues. Later, Feedback.
4. **Trim**: −10%, −20%, −35%, −50%.

**Overflow**: today's text area, unchanged.

The floating Lab menu goes away. Its contents live in Review. The ⌘K entries stay.

## The page

- **Highlights show only while Review is open.** An open Review tab is Hemingway's Edit mode. A
  closed one is Write mode. There is no separate mode switch.
- Highlights use a background tint. Alternatives keep their underline and dots. Ghosts keep their
  fade. The tints avoid the accent purple, which belongs to alternatives.
- Lab marks and cuts work as today.
- ⌘+, ⌘−, and ⌘0 change the size of the page text, from 12 to 28 px. The bars and panels keep
  their size.
- The line width is in characters of the page text: narrow 44, medium 52, wide 64. So the column
  widens as the text grows, up to the window.

## Bars

- **Top**: "171 words · grade 8". A click opens Review. The layers toggle moves to ⌘⇧L and ⌘K only.
- **Bottom**: the left panel's toggle at the left edge, the right panel's at the right edge. Open
  and Save stay at the left, then the toast, then ⌘K.

## Shortcuts

| Keys | Today                     | After                                   |
| ---- | ------------------------- | --------------------------------------- |
| ⌘⇧A  | Alternatives panel        | Here panel                              |
| ⌘⇧G  | Suggest other ways        | Unchanged                               |
| ⌘⇧E  | Lab menu                  | Review tab                              |
| ⌘⇧O  | Overflow panel            | Overflow tab                            |
| ⌘⇧L  | Layers                    | Unchanged; no longer on the word count  |

## Narrow windows

Below 760px, both panels already float over the page (`src/styles.css`). Keep that. In a very
narrow window with both open, they overlap. That is fine at that width.

## Live checks

All local, no network. The rules are in `src/prose/`, a library with no editor code, so its tests
run on plain strings. `src/editor/highlights.ts` draws them on the page.

- **Prose**: paragraphs, list items, and quotes. Headings (also underlined ones), code (also
  indented), tables, HTML, link addresses, bare web addresses, and ghosted text are skipped. A
  sentence never runs from one list item into the next.
- **Sentences**: split after `.`, `!`, and `?`. Not after "Mr.", an initial, "e.g.", or a decimal
  point, and not when the next word starts in lowercase. "No." and "fig." are abbreviations only
  before a number.
- **Grade**: the Automated Readability Index, rounded, never below zero.
- **Hard and very hard**: a sentence of 14 or more words, by its own grade: hard from 10, very hard
  from 14.

The weakener lists follow what Hemingway's web editor marked on about 650 test sentences, one at
a time. They are short on purpose: a mark that is often wrong teaches you to ignore the marks.

- **Adverbs**: -ly words, minus words that only end in -ly (family, only, early) and the ones
  Hemingway leaves alone (usually, finally, actually).
- **Passive voice**: a form of "be", maybe an -ly word, then a past participle.
- **Qualifiers, intensifiers, fillers**: Hemingway's short lists. "Probably" is only an adverb, and
  "rather" and "kind of" aren't marked.
- **Weak verbs**: a plain verb and an adverb that one stronger verb replaces, in the same tense
  (walked slowly → strolled, said loudly → shouted). "Get" isn't marked.
- **Hidden actions**: exact phrases, in any tense (made a decision → decided, is able to → can).
  "Made the decision" and "made a quick decision" aren't marked.
- **Negatives**: a negative that one positive word says (does not have → lacks, did not succeed →
  failed). A plain "do not want" isn't marked. Hemingway's category is "negative or indirect
  phrases", but it marked none of the indirect openings we tried.
- **Simpler words**: a phrase list (utilize → use, in order to → to, not many → few), in any form
  (modify → modified, transmit → transmitted). "However," at the start of a sentence → "But".
- **Redundant pairs**: one word already says what the other adds (end result → result, reverted back
  → reverted, very unique → unique), in any tense, and nouns in the plural too. The adverb or
  intensifier inside isn't marked again.
- **Clichés**: exact phrases, verbs in any tense (moved the needle). Only ones rarely meant
  literally; "at the end of the day" is the exception worth its false marks. No fix: the popover
  offers "Suggest rewrites".

Zinsser's clutter from *On Writing Well* adds to Hemingway's lists: wordy phrases (at the present
time → now, for the purpose of → for), "currently" → "now", fillers (I might add, it is interesting
to note), redundant pairs, and clichés.

The longer match wins where two marks overlap. Adverbs and passive voice may sit inside other
marks, so "really" counts as an intensifier and an adverb, as in Hemingway. Only one tint shows,
and the weakeners' total counts it once. An adverb inside passive voice is its own mark, as
Hemingway counts it.

Each block's result is kept until the block changes, so an edit checks only the paragraph it
changed. On a 20,000-word page in paragraphs, the first check takes 25 to 50 ms, and each edit
after it under 1 ms. A long paragraph is slow: 20,000 words in one paragraph cost 117 ms per
keystroke in WebKit's engine. The checks run with Review closed too, for the grade in the top bar.

**Writing issues** come from Claude, on request: "Find writing issues" in Review or ⌘K. Each has a
reason and a fix. Claude quotes a snippet and its corrected form; the mark covers the words that
change. The quotes are found on the page as it is when the answer comes, so typing meanwhile is
safe. Code is skipped. Review opens to show the marks. "Use" replaces the words with the fix, and
undo brings them back. A fix that adds or drops a space takes in the whole word.
A fix isn't offered in code, over part of a ghost, over an alternative, or where it would start a
line with Markdown markup. A mark moves with edits, and goes away when its own text changes. ⌘Z
on that edit brings the mark back. "Use all" uses every fix that fits in one change.

The rules are for English.

## Phases

Each phase ends with the tests passing and the change tried in the app.

1. **Layout only** (done, 2026-10-26). Right panel with Review and Overflow tabs. Lab contents
   move into Review. Here keeps today's Alternatives contents. Bars and shortcuts as above. No new
   features.
2. **Checker spike, go or no-go** (skipped, 2026-10-26). The real module was built test-first
   instead, and its speed measured on a long page. See "Live checks". Not checked: how the tints
   look under alternatives and ghosts in the app.
3. **Live checks** (mostly done, 2026-10-26). The module, its tests, the highlights, the Review
   rows with counts, eyes, and jumps, "Why it's marked" in Review, all of Hemingway's weakeners,
   the grade in the top bar, and writing issues from Claude. Still to do: the reason in Here, and
   "More" stats.
4. **Rewrite verbs in Here** (2–3 days). Simplify, Shorter, Polish, Tone, free text. Each result as
   a variant or a version, with undo and redo tests.
5. **Feedback** (1–2 days). After deciding where its text goes.

Phases 4 and 5 don't need the checker, so either can come next.

## Risks

- **Visual noise.** Tints, underlines, dots, ghost fades, and Lab marks on one line. The rule
  "highlights only while Review is open" is the main defense. Not yet checked in the app.
- **Speed.** Each keystroke checks its whole paragraph again, so a very long paragraph is slow.
  Decorations must stay limited to the viewport.
- **Sentence splitting in Markdown.** Abbreviations, quotes, links, inline code, and list items
  break naive rules. Tests need many real cases.
- **Grade worship.** Hemingway's grade rewards short words and short sentences. Undertext should
  show it, not push it.
- **English only.** Writing in another language gets wrong highlights.

## Decisions taken

- The tab is called Review. "The Lab" is gone from the UI, the README, and the palette. Code names
  such as `src/editor/lab.ts` stay.
- ⌘⇧E works like ⌘⇧O: it shows and focuses its tab, and closes the panel from inside it. Esc goes
  back to the page and leaves the panel open.
- Review and Overflow are two tabs of one panel. Only one shows at a time.
- Lab results stay in the bar under the page for now. See open decision 8.
- A run from Review keeps the panel open and puts the focus on the page, where the results are.
- Live local checks come first: Hemingway's highlights are what Undertext lacks.
- Highlights show only while Review is open. There is no separate Write and Edit switch.
- The grade is the Automated Readability Index, as in open-source Hemingway clones. The target is
  fixed: hard from grade 10.
- The first slice had hard and very hard sentences, five weakeners (adverbs, passive voice,
  qualifiers, intensifiers, fillers), and simpler words. Grammar waited for Claude: rules can't do
  it well.
- Simpler words are green, not Hemingway's purple. Purple is the accent, and it belongs to
  alternatives.
- Ghosted text isn't checked, as it isn't counted.
- "Why it's marked" shows in Review, under the grade. A click on a highlight opens a popover with
  the reason and what to do. There are no hover tooltips.
- The popover belongs to the caret: it opens on a click or a row's jump, and closes when you type,
  move off the mark, select, press Esc, or close Review. So it never points at text that changed,
  as Hemingway's can.
- Each action keeps a way back. A suggestion becomes an alternative. A word to cut can be ghosted
  or removed; after "Ghost it" the popover stays on the ghost, with "Remove it" and "Revive it",
  and a click on any ghost while Review is open offers the same. Removing tidies the spaces,
  commas, and capital around the words, and undo brings them back. A writing issue Claude says to
  cut offers "Remove it". Passive voice, hard sentences, and hidden actions with no suggestion get "Suggest
  rewrites". Its prompt names the goal,
  such as the active voice, and the live checks drop any rewrite they would still mark. The first
  version reused ⌘⇧G, whose drop-in prompt kept 4 of 6 rewrites passive. The prompt names the words
  the checks flagged and the rewrites the sentence has, and a second ask adds to them. ⌥↩ runs the
  first action. Where no action fits, the popover says why in a line: code, a ghost, an
  alternative, a line break, or bold or italics that the sentence cuts through.
- Suggestions take the form and case of the marked words: "made a decision" → "decided", "has made
  a choice" → "chosen", "She's made a choice" → "chosen", "Not many" → "Few". A hidden action takes
  the "of" after it ("carried out a review of" → "reviewed"), and an "a" or "an" before a suggestion
  changes to fit. Where no form fits, as "will be able to" → "can", "do not have to" → "lack to",
  or "an additional fee" → "an more fee", the mark stays with no suggestion.
- The popover sits where you clicked, and closes when the layers or Claude's issues change, since
  either can change what it offers. Review's panel and its Use button, the palette, and ⌥↩ follow
  the popover's mark.
- No layer may sit where a save can't keep it. ⌘/ won't ghost code, or leave a ghost on part of an
  alternative, and says why. Paste quietly leaves out a ghost or an alternative that would land
  inside an alternative; the words it pastes stay.
- Rewrites from Claude with a line break, a backtick, HTML, half of some bold or italics, or block
  markup where the sentence starts a line are dropped. The first three can save a page that
  reopens differently; the others would change how it looks. ⌘⇧G drops them too.
- The checks run with Review closed too, so the top bar shows the grade. Highlights still show
  only while Review is open.
- Writing issues come from Claude on request, never as you type, so nothing is sent until you ask.
- A writing issue's fix replaces the words, with no alternative. Claude is asked to flag only
  mistakes, not style, so the old words aren't worth keeping, and undo brings them back. Suggestions from the live checks
  are style choices, so they still become alternatives.
- Writing issues are pink. Green was taken by simpler words.
- A writing issue goes away when its own text changes, not its whole paragraph. That way using one
  fix keeps the others in the paragraph.
- While writing, labels and progress text name what a task does, not who does it: "Suggest other
  ways", "Suggest rewrites", "Finding other ways to say it…". No "AI" or "Claude". Settings, the
  setup dialogs, and errors from the service still name Claude: they are about your account, or
  about what failed.
- While suggestions load, the Word and Sentence tab keeps the button in place, disabled, with a
  spinner, and two faint rows pulse where the suggestions will land. On the Paragraph tab, the
  toolbar shows the task instead. Any running task disables the button. Esc in the panel cancels a
  running task, and closes the panel only when nothing runs.
- Appearance has no settings window. The text size has keys, and ⌘K holds the theme and the
  line width, with the rest of the app's commands. A native View menu would mean building the
  whole menu bar in Rust, Edit menu included.
- The theme is system, light, or dark. `App.tsx` sets `data-theme` on the page, from the choice or
  from the system's, and sets the window's theme too, so the title bar and its buttons match.
  The CSS keeps one light palette, not a copy for the media query and another for the choice.
- Before the line width followed the text, the column was 64 characters of the 12 px UI font:
  about 51 of the page's. Medium, 52, keeps that look.
- The weakener lists copy what Hemingway marks, checked sentence by sentence in its web editor.
  The first lists used broad patterns and marked about twice as much, much of it wrong, such as
  every "get".
- Zinsser's rules joined them on 2026-10-28, only as exact lists that are rarely wrong: wordy
  phrases, redundant pairs, clichés, and "However," → "But". Redundant pairs and clichés are
  weakeners, blue, with a row each. "However," is a simpler word. "Currently" → "now" is marked,
  though Hemingway leaves it alone, because Zinsser names it. Rules that guess, such as "kind of"
  as a qualifier or "which" for "that", wait: they would need to start hidden.

## Spelling

Added 2026-10-27. Spelling isn't one of Review's checks: a typo isn't a style call, so its marks
show while writing too.

- **The Mac's checker, our marks.** Rust asks NSSpellChecker (`src-tauri/src/spelling.rs`); the
  page draws a wavy red underline (`src/editor/spelling.ts`). WebKit's own spelling stays off: it
  only checks words you edit, marks code and Markdown, puts its suggestions in a menu Undertext
  replaces, and needs a macOS setting it doesn't have by default. A bundled word list would work off
  the Mac, but with weaker suggestions and a word list of its own.
- **When it checks.** On open, then each changed paragraph 400 ms after you stop typing. Answers
  are kept by paragraph text, so an undo needs no new check. A word you are typing isn't marked
  until the caret leaves it. A clean 18,000-word page checks in about 75 ms.
- **Guesses come on demand.** Each costs about 4 ms, too slow to fetch for every mark. The caret
  entering a word fetches its guesses, so a click or a right-click has them.
- **Languages.** The checker finds each paragraph's language among the ones in System Settings. On
  a line too short to tell, it accepts a word from any of them: "We teh" passes, as "teh" is
  Indonesian. Such a line is checked in the page's language instead.
- **A fix replaces the word**, with ⌘Z to undo. It isn't an alternative: the misspelling isn't a
  version worth keeping. An alternative or ghost around the word keeps it. A fix that would cut one
  isn't offered.
- **Learn spelling** adds the word to the Mac's dictionary, shared with every app, and unmarks it in
  any case. ⌥↩ never learns, so a key pressed before the guesses come can't teach the Mac a typo.
  The names are Apple's, from TextEdit and Mail; "Add to dictionary" was the other choice.
- **Unlearn spelling.** ⌘Z can't undo learning, as the word list lives outside the page, so the bar
  under the page says how to undo it. A learned word has no mark to click, so the way back is the
  right-click menu: on any word in the Mac's list, also one learned in another app, it starts with
  "Unlearn spelling". The Mac matches "Teh" to a learned "teh" both ways. The page then asks the
  checker again about each paragraph with the word.
- **No list of exceptions per article.** The owner chose the Mac's shared list only. Such a list
  would have to live in the file to travel with it, a file-format change.
- **The popover** opens on a misspelled word with Review closed, before any Review mark around it.
  Review's panel and palette entries leave spelling out. Right-click lists up to five guesses and
  "Learn spelling" above the usual items; the popover shows four.

## Punctuation

Added 2026-10-27. The Mac's spell checker marks words it doesn't know, and nothing else. On seven
test lines it caught "definately" and "tomorow", and "the the" only with its grammar option. It
missed "Its easy", "loose track", "the words that slips", "Their going", "said ,", "fine.Then",
"--", a spaced hyphen, "highly-rated", "received .", and a comma splice. Claude's writing issues
can find the wrong words. Local rules can find most of the punctuation.

Six releases, in this order, each its own commit after a review.

1. **One AI check for mistakes.** "Fix punctuation and typos" goes. Writing issues cover what it
   did, with a reason for each, and a mistake isn't worth keeping as an alternative. Writing issues
   get "Use all": one change for every fix that fits, and one ⌘Z brings them all back. An issue
   with no fix, or with a fix that doesn't fit, stays marked. A writing issue on exactly a
   misspelled word isn't marked when the Mac suggests the same fix, as the spelling mark offers it.
   "Use all" is its own undo step, and uses only the marks Review shows. ⌘Z on any edit that drops
   writing issues, a fix or typing, brings those marks back, beside any newer ones.
2. **No new dashes from Claude.** The prompts for other ways to say it and for rewrites say not to
   add a dash. A suggestion with more dashes than the text it replaces is dropped. A dash here is
   "—", "–" between words, "--", or a hyphen with a space on each side; "1990–1995" is a range.
3. **Punctuation mistakes as you write.** Local rules, most with one right fix. Like spelling, they
   show with Review open or closed, as a dotted blue underline, and a click opens the popover. The
   fix replaces the text, and ⌘Z brings it back. The rules:
   - A space before `,` `.` `;` `:` `!` or `?`: "said ," becomes "said,".
   - No space after a comma or semicolon between letters: "red,green" becomes "red, green".
     Numbers such as "1,000" stay.
   - No space after the end of a sentence: "fine.Then" becomes "fine. Then". This needs a
     lowercase letter, the stop, then a capital and a lowercase letter, so "e.g.", "U.S.", and
     "Node.js" stay.
   - Doubled punctuation: ",," becomes ",", and ".." becomes ".". An ellipsis stays.
   - A doubled word: "the the" becomes "the". "Had had", "that that", and a few more stay.
   - "--", or a hyphen with a space on each side, between words becomes a dash in the page's style.
     Between numbers, "--" becomes an en dash: "1990–1995". A hyphen between numbers, hours, days,
     or months is a range, as in "9am - 5pm", "2019 - present", and "Monday - Friday", and stays,
     and so does an arrow, "-->".
   - A hyphen after an -ly adverb: "highly-rated" becomes "highly rated". Words that only end in
     -ly stay, as in "family-owned" and "early-stage".
   - An opening `(` or `“` with no closing one in its paragraph, or a closing one with no opening
     one. There is no fix: the popover says what's missing. ":)", "a)", and a bracket next to a bare
     address don't count. A quote may run on into a paragraph that opens with one, as in fiction.
   - "the 1990's" becomes "the 1990s".

   Code, link addresses, HTML, and ghosted text aren't checked, and no rule reads across them. A
   mistake you are typing waits until the caret leaves it, and a lone opening bracket or quote while
   you type on in its sentence. A click on words with a Review mark opens that mark first; a
   punctuation mistake comes before a mark on a whole sentence. Each block's result is kept until the
   block or the page's dash style changes: on a 22,000-word page in Node, the first check takes
   16 ms, and each edit after it 2 ms; on 100,000 words, 46 ms and 6 ms. The fix is its own undo step, as a spelling fix is.
4. **Dashes in Review.** A live check, shown only while Review is open, with a row, a count, and an
   eye. A dash is "—", or "–" with a space on each side; "1990–1995" is a range. A paragraph may
   use dashes once: a pair around an aside, or one dash before a break. Each later use in it is
   marked: a pair from dash to dash, a single dash to the end of its sentence. The popover offers
   "Suggest rewrites", aimed at a comma, a colon, parentheses, or a period, and a rewrite that
   still has a dash is dropped. A dash in the page's less common style is marked too, with the
   page's style as its fix. A range, a dash that starts a line (a bullet or an attribution), a run
   such as "C——", and speech that breaks off ("But—”") or stammers ("I—I") don't count. A dash too
   many is marked once, not also for its style. The row reads "N dashes to check", in teal, as
   purple is the accent; its eye hides both kinds. The style fix becomes an alternative, as other
   live-check suggestions do: a style choice, where release 3's fixes correct mistakes. The page's
   style comes from its prose, without code, link addresses, or ranges. Known misses: a "?" inside
   an aside splits its pair, and two single dashes in one sentence read as a pair. A dash too many
   that runs across a line break offers no rewrite, as a hard sentence there doesn't.
5. **Smart quotes and dashes as you type.** Always on, except in code. `"` and `'` become curly:
   opening after a space, an opening bracket or quote, or the start of a line, else closing. An
   apostrophe is a closing quote. A second `-` turns "--" into a dash: an en dash between numbers
   or where the page's style is spaced en dashes, else an em dash; ">" right after turns it back
   into an arrow, "-->". ⌘Z right after brings back what you typed. A line that
   starts with "--" stays, so "---" still makes a rule, and so does "<!--". Pasted text stays as
   it is: CodeMirror asks the input handler about typing only. Built in `src/editor/smart.ts`: the
   typed character goes in first, and the curly quote or dash replaces it as its own undo step.
   Code, HTML, a comment, a link's address, a bare address, and a link definition are left alone,
   and so are hyphens in a table's rows or at the edge of a ghost or an alternative, and text typed
   while an input method composes. A quote after a dash closes, and opens once a letter follows it
   ("—“Go"); "--" after a number becomes an en dash once a number follows it. Claude's answers are matched with quotes straightened, so its
   straight quotes still find a page's curly ones. Known misses: an apostrophe that starts a word,
   as in "'90s", becomes an opening quote; YAML front matter is curled; "--" in an address typed before
   its "@" or "://" becomes a dash; and a stray backtick or "a<b" turns curling off for the rest of
   its paragraph.
6. **Sharper writing issues.** The prompt names the punctuation mistakes the rules can't find:
   comma splices, "its" and "it's", a comma between subject and verb, and an aside that opens with
   a dash and closes with a comma. It leaves out words that aren't real words, which the spell
   checker marks. A fix adds no dash: a comma splice gets a period or a semicolon, and an aside
   closes the way it opens, or its dash becomes a comma. Undertext drops a fix that would leave its
   line with more dashes than before. The shared preamble gets the space it lacked
   ("formatting.Paragraphs").

   Tried with the app's own Claude call, one run per prompt, on sample paragraphs written for it.
   Every run found the comma splice, "its", the comma between subject and verb, and the aside, so
   the gain is in the fixes, not in what is found. The old prompt's run had two fixes that added a
   dash. The final prompt's run had none, left out "definately", and found "Note:this" and "said
   ,then", which no local rule marks. It also marked three slips the local checks mark already, so
   those can show a pink mark in Review beside the dotted one. An earlier draft told Claude to
   leave such slips out, which would have left "Note:this" unmarked.

**The page's dash style** is closed em dashes ("word—word"), spaced em dashes ("word — word"), or
spaced en dashes ("word – word"), whichever the page uses most. A page with no dashes uses closed
em dashes. Releases 3, 4, and 5 follow it.

Left out for now: straight and curly quotes mixed on one page, and "..." mixed with "…". Their fix
needs release 5's rule for opening and closing quotes, so they can come after it. Exclamation marks
and the serial comma are style calls with no rule to check.

## Open decisions

1. **Which side.** macOS apps put the inspector on the right. Undertext has Alternatives on the
   left. Phase 1 kept the left, because it is learned and the right has the page tools.
2. **Rewrites across paragraphs.** An alternative can't span a line break. A selection across
   paragraphs could become one version per paragraph, or be refused.
3. **Where Feedback goes.** A section in Review, a third tab, or text added to Overflow.
4. **"Why it's marked" in Here.** It shows in Review now. Also show it in the Here panel, or not.
5. **The long-sentences check.** Today it is an instant check in Review. Live "hard" and "very
   hard" now cover it. Remove it, or keep it as a one-shot check.
6. **Writing issues and typo fixes.** Decided 2026-10-27: the typo fix goes, and writing issues get
   "Use all". See "Punctuation".
7. **Adverbs hidden at first.** Hemingway counts adverbs but hides their marks until you show
   them. Undertext shows them. Do the same as Hemingway, or not.
8. **Lab results.** They show in the bar under the page. Move them into Review, or keep the bar.
