<p align="center">
  <img src="brand/icon-tile.svg" alt="Undertext icon" width="120">
</p>

<h1 align="center">Undertext</h1>

<p align="center">
  <strong>A writing tool with layers under the text.</strong><br>
  Try other words in place, dim what you might cut, and keep your leftovers close.
</p>

<p align="center">
  <a href="#build-and-run">Build and run</a> ·
  <a href="#shortcuts">Shortcuts</a> ·
  <a href="#spelling">Spelling</a> ·
  <a href="#punctuation">Punctuation</a> ·
  <a href="#ai-and-review">AI and Review</a> ·
  <a href="https://github.com/klipstack/undertext/issues">Issues</a>
</p>

> **All credit for the ideas goes to Jason Fried.** In
> [this tweet](https://x.com/jasonfried/status/2105403067793584590) he showed Write_On, a writing tool
> he built for himself: alternatives for words, sentences, and paragraphs, dimmed text, a place to
> stash extra writing, and an AI "lab" that trims without rewriting. Undertext is an open-source
> rebuild of those ideas, made from watching his video. It is not affiliated with Jason Fried or
> 37signals.

A local writing tool with layers under the text. Your words stay plain Markdown. The layers hold the
other ways you might say them.

![Undertext in dark mode](docs/screenshot.png)

- **Live Markdown.** Headings, bold, links, lists, and quotes render as you type. Their syntax shows
  when the cursor touches them.
- **Alternatives.** A word or sentence can have several versions. Hover over it and press ↑ or ↓, or
  press ⌥J and ⌥K, to read each one in place.
- **Paragraph versions.** Fork a paragraph, rewrite it in place, and switch between the versions.
- **Ghost.** Dim text you might cut. It stays readable but easy to ignore.
- **Spelling.** Your Mac's spell checker underlines words it doesn't know, as you write.
- **Punctuation.** Slips such as "said ," or "the the" get a dotted line and a fix, as you write.
- **Review.** A side panel that grades the page and highlights hard sentences, weakeners, and
  simpler words as you type. Optional AI help finds writing issues, marks, fixes, and trims, but
  never rewrites your text on its own.
- **Overflow.** A tab beside Review for leftovers you might use later.
- **Keyboard first.** Every action has a shortcut, and ⌘K lists them all.

## Status

An experiment that works for daily writing. It is built and tested on macOS. Windows and Linux
should build with Tauri, but nobody has tried them yet.

## Build and run

You need Node 22+, pnpm, and Rust. On macOS, install Rust with
`brew install rustup && rustup default stable` and add `/opt/homebrew/opt/rustup/bin` to your `PATH`.

```bash
pnpm install
pnpm tauri dev      # the desktop app, with live reload
pnpm tauri build    # src-tauri/target/release/bundle/macos/Undertext.app
```

Then copy `Undertext.app` to `/Applications`.

`pnpm dev` runs the editor in a plain browser. It has no file access, keeps your document in local
storage, and answers AI requests with fake results so you can try the UI.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘K | Command palette: every action available right now, with its shortcut |
| ⌘⇧A | Alternatives for the word at the cursor or the selection |
| ⌘⇧G | Suggest other ways to say the word or selection |
| ⌘⇧E | Review: readability, writing issues, checks that mark text, and trims. Press again in Review to close it. Esc goes back to the page. |
| ⌥J ⌥K | Next / previous version at the cursor (word or sentence, else paragraph) |
| ⌥⇧J ⌥⇧K | Next / previous version of the paragraph |
| ⌥L ⌥H | Jump to the next / previous item that has versions (or a mark or cut from a Review check) |
| ⌥↩ | Do what the Review highlight at the cursor suggests: use the suggestion, ghost the word, or ask Claude for rewrites |
| hover + ↑ ↓ | Cycle the hovered word, sentence, or paragraph |
| ⌘⇧D | New version of the current paragraph |
| ⌘/ | Ghost the selection, or revive the ghost at the cursor |
| ⌘⇧X | Stash the selection in Overflow |
| ⌘⇧O | Open Overflow and type in it. Press again in Overflow to close it. Esc goes back to the page. |
| ⌘⇧L | Show or hide the layers |
| ⌘+ ⌘− ⌘0 | Bigger, smaller, or default text size. The column widens with the text. ⌘K also sets the theme and the line width. |
| ⌘B ⌘I ⌘E | Bold, italic, inline code. On a selection, a word, or formatted text (removes it) |
| ⌘⇧K | Link: wraps the selection as `[text]()`. Pasting a URL over a selection also makes a link. |
| ⌥⌘1 ⌥⌘2 ⌥⌘3 ⌥⌘0 | Heading 1, 2, 3, or back to plain text. The same heading again removes it. |
| ⌘⇧8 ⌘⇧7 ⌘⇧9 | Bulleted, numbered, or task list. The same list again removes it. |
| ⌘-click | Open a link |
| ⌘O, ⌘S, ⌘⇧S, ⌘N | Open, save, save as, new |
| Right click | Context menu. On a misspelled word, it starts with suggestions. "Look Up" shows the Mac's dictionary. Shift + right click shows the system menu. |

- ⌥J, ⌥K, ⌥H, and ⌥L match the physical key, so they work on any keyboard layout. In Undertext they no
  longer type ∆ ˚ ˙ ¬. Dead keys such as ⌥E and ⌥N still work for accents and ñ.
- Hover cycling only works after you move the mouse. Typing or clicking turns it off until the mouse
  moves again, so arrow keys never cycle by accident.
- Files that have a path save automatically. Untitled documents survive restarts in local storage.
- If another app changes the file, Undertext reloads it when you come back to the window. If you also
  have edits, it asks which version to keep instead. A save never overwrites the other app's change
  without asking.
- Letters typed right after an alternative join it, so "elephant" can become "elephants". A space or
  punctuation starts plain text after it.
- ⌘K → "Open the welcome document" brings back the built-in tour at any time.

## File format

Plain Markdown with four small additions:

```markdown
# {{The Obvious, the Easy, and the Possible|Three Buckets}}

Much of the {{tension|pressure|>struggle}} comes from here. {-Maybe cut this.-}

:::alt
First version of a paragraph.
:::or*
Second version, which is active.
:::

<!-- overflow -->

Leftovers live after the marker.
```

- `{{a|b|>c}}`: alternatives. The first item is the original. `>` marks the active one.
- `{{calls|~judgments}}`: `~` marks a suggestion that came from AI.
- `{-text-}`: ghosted text. Other Markdown tools show the braces as plain text.
- `:::alt` … `:::or` … `:::`: paragraph versions. `*` marks the active one.
- `<!-- overflow -->`: everything after this line is the Overflow tab.
- Everything else is plain Markdown and stays exactly as you wrote it, so `~~text~~` is ordinary
  strikethrough. The additions are not read inside code.
- A save adds a backslash only where your text would read as an addition: before `{{` and `{-`, and
  before a line that reads `:::alt` or `<!-- overflow -->`. Inside `{{ }}`, `\` escapes `| } > ~ \`.

Older files wrote ghosts as `~~text~~`. Those now open as strikethrough.

## Spelling

Your Mac's spell checker underlines the words it doesn't know with a wavy red line, as you write.
Review doesn't need to be open. A word you are still typing waits until you move on. Each paragraph
is checked in its own language, from the ones set in System Settings → Keyboard → Text Input. A
line too short to tell, such as "We teh", is checked in the page's language. Code, link addresses,
and ghosted text aren't checked.

Click a misspelled word, or right-click it, for suggestions. A suggestion takes the word's place,
and ⌘Z brings it back. ⌥↩ uses the first one. "Learn spelling" adds the word to your Mac's
dictionary, which every app shares. ⌘Z can't undo that: right-click the word and choose "Unlearn
spelling". It shows on any word in your Mac's dictionary, also one learned in another app.

## Punctuation

Punctuation slips get a dotted blue line as you write, with Review open or closed. Each has one
right fix:

- A space before punctuation: "said ," becomes "said,".
- No space after a comma, a semicolon, or the end of a sentence: "fine.Then" becomes "fine. Then".
- Doubled punctuation or a doubled word: ",," and "the the". "Had had" and "that that" stay.
- Hyphens for a dash: "late--very" and "late - very" become "late—very", or "late — very" or
  "late – very" on a page that spaces its dashes. Between numbers, "1990--1995" becomes "1990–1995".
  "9am - 5pm" and "Monday - Friday" stay.
- A hyphen after an -ly adverb: "highly-rated" becomes "highly rated".
- A decade with an apostrophe: "the 1990's" becomes "the 1990s".

A parenthesis or a curly double quote with no partner in its paragraph is marked too. Only you know
where its partner goes, so it has no fix. A quote may run on into a paragraph that opens with one,
as in fiction. Click a mark to see what's wrong, and use the fix or press ⌥↩. ⌘Z brings your text
back. A slip you are still typing waits until you move on, and an opening parenthesis or quote
waits while you type on in its sentence. Code, link addresses, HTML, and ghosted text aren't checked. The rules
are for English.

Quotes curl as you type: `"` and `'` become “ ” and ‘ ’, and an apostrophe becomes ’. Two hyphens
become a dash: — on most pages, – between numbers or on a page of spaced en dashes, and `-->` stays
an arrow. ⌘Z right after brings back what you typed. Code, HTML, comments, and addresses keep what
you type. So do hyphens at the start of a line, so `---` still makes a rule, and hyphens in a
table. Pasted text stays as it is.

## AI and Review

Review is the first tab of the right panel. Press ⌘⇧E, or click the word count and grade.

**Highlights.** While Review is open, the page shows what makes it harder to read, in the style of
[Hemingway Editor](https://hemingwayapp.com). The checks run on your machine, with no AI, and
update as you type.

- **Grade:** the Automated Readability Index of the page. It also shows in the top bar.
- **Hard and very hard sentences** (yellow and red): 14 words or more, from grade 10 or 14.
- **Weakeners** (blue): adverbs, passive voice, qualifiers, intensifiers, weak verbs (walked slowly
  → strolled), fillers, hidden actions (made a decision → decided), negatives (does not have →
  lacks), redundant pairs (end result → result), and clichés (at the end of the day). The lists
  follow what Hemingway marks, with the clutter William Zinsser names in *On Writing Well*.
- **Simpler words** (green): utilize → use, in order to → to, at the present time → now, and
  "However," at the start of a sentence → "But".
- **Dashes** (teal): a paragraph may use dashes once, as a pair around an aside or one dash before a
  break. Each use after that is marked. A dash in another style than the page's is marked too, and
  its fix becomes an alternative. A range such as 1990 – 1995, a dash that starts a line, and speech
  that breaks off ("But—”") don't count.
- **Writing issues** (pink): grammar, spelling, and wrong words, from Claude. See below.
- Click a row to go to the next one. The eye hides a kind on the page but keeps its count. Adverbs
  start hidden, as in Hemingway. Ghosted text and code aren't checked. The rules are for English.

**Click a highlight** to see why it's marked and what to do. A suggestion, in the form and case of
your words, becomes an alternative, and ⌥K brings yours back. An adverb, qualifier, intensifier, or
filler can be ghosted, so you read the sentence without it, or removed. A click on ghosted text
offers "Remove it" and "Revive it". Removing tidies the spaces, commas, and capital around the
words, and ⌘Z brings them back. Passive voice, hard sentences, hidden actions with no suggestion,
clichés, and a dash too many offer "Suggest rewrites": Claude rewrites the sentence to fix it. The rewrites
that the checks no longer mark join it as alternatives. A rewrite with more dashes than your
sentence is left out, and for a dash too many, one with any dash. Ask again for more.
Only that button, ⌥↩ on such a mark, or its ⌘K entry sends the paragraph to Claude. ⌥↩ does the first action at
the cursor, and ⌘K lists it too. Where none fits, say in code or inside an alternative, the popover
says why. It closes when you type, move off the mark, or press Esc.

The AI features are optional. They never rewrite your text on their own: every result is something
you can see and undo.

- **Alternatives (⌘⇧G):** about 6 suggestions join the word's versions. Your current text stays.
  Undertext asks Claude not to add dashes, and leaves out a suggestion with more dashes than your
  text. A range such as 1990–1995 isn't a dash.
  While they load, the panel shows where they will land, and Esc cancels.
- **Find writing issues:** Claude marks grammar, spelling, and wrong words in pink, each with a
  reason and a fix. It looks hardest at the punctuation the local checks can't see: comma splices,
  "its" and "it's", a comma between a subject and its verb, and an aside opened with a dash and
  closed with a comma. Undertext leaves out a fix that adds a dash to its line. Review opens to show them. Click one and use its button, or put the caret on it
  and press ⌥↩: the fix replaces the mistake, and ⌘Z brings it back. "Use all" in Review uses
  every fix that fits at once, and one ⌘Z brings back your words and the marks. A mark goes away
  when you edit its text. A word the spell checker marks gets no pink mark when your Mac suggests
  the same fix. Code is left alone.
- **Checks:** weakest sentences, convoluted sentences, off-tone words, and hedges and filler. Marks
  are temporary highlights with a reason. "Sentences that run long" runs locally, without AI.
- **Trim (−10% to −50%):** Claude may only delete. Proposed cuts appear faded. Click one to keep it,
  then make the cuts, keep them as ghosts, or go back to the original.

**Privacy.** Each AI request sends your whole document to Anthropic's API. Nothing is sent until you
use an AI feature.

**Setup.** Press ⌘K, choose "Set the Anthropic API key…", and paste a key from
[platform.claude.com](https://platform.claude.com). The key is stored in the macOS Keychain, and
requests go out from the app's Rust side, so the key never reaches the web page. During development,
`ANTHROPIC_API_KEY` works too. Requests use `claude-opus-5-5`; a check on a 1,000-word piece costs a
few cents.

**Or use your Claude subscription.** With no API key set, requests can go through
[Claude Code](https://claude.com/code) on your Claude plan instead. Install Claude Code and sign in by
running `claude` in a terminal, then press ⌘K, choose "Use your Claude subscription…", and confirm.
Undertext never signs you in and never uses the subscription until you choose it there; "Stop using
subscription" turns it off without signing Claude Code out. Requests count against your plan's usage
limits. If `claude` isn't in `~/.local/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`, set
`CLAUDE_PATH`. A saved API key always takes priority.

## Known limitations

- A ghost can't cover only part of an alternative: a save would lose it. ⌘/, Review's popover, and
  "Keep as ghosts" leave that text as it is and say why. Ghost the whole alternative instead.
- Tables, images, and HTML show as Markdown source, not rendered.
- Spelling covers the page, not Overflow. It needs macOS: in a plain browser (`pnpm dev`), a few
  common typos stand in for it.

## Development

```bash
pnpm verify         # every check CI runs: types, tests, web build, Rust format, lint, and tests
pnpm test           # only the vitest tests
pnpm icons          # rebuild the app icons from brand/ (needs ImageMagick)
```

`pnpm verify` is also what coding agents run to prove their work. See
[docs/agents.md](docs/agents.md).

The editor is [CodeMirror](https://codemirror.net) inside a [Tauri](https://tauri.app) app. The page
text is plain Markdown; alternatives, ghosts, and versions are ranges kept beside it (`src/editor/layers.ts`).
The icon borrows the mark of [Klipstack](brand/README.md), with a handwritten u in place of its clip.

## License

[MIT](LICENSE)
