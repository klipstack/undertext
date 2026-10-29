# Moving the editor to CodeMirror 6

Status: done and on `main`, 2026-10-25. See "Decisions taken" and "Next" at the end. Written
2026-10-20.

## Goals

- Obsidian-style live preview. Markdown renders in place. Its syntax shows when the cursor touches it.
- Proper Markdown: links, inline code, strikethrough, quotes, task lists, code blocks.
- Formatting shortcuts: ⌘B, ⌘I, ⌘E, links.
- Ghosts written as `{-x-}`, so `~~x~~` can be real strikethrough.
- Everything that works today keeps working: alternatives, paragraph versions, ghosts, the Lab,
  Overflow, keyboard cycling.

Not in scope for now: rendered tables and images, Overflow as a CodeMirror editor, renaming `:::alt`.

## Why CodeMirror 6

- Hiding syntax is built in (replace decorations, atomic ranges). ProseMirror can only hide
  characters with CSS, and the caret still walks through them.
- Each line is its own element. Wrapped list items can indent under their text.
- It draws its own cursor. `caretPlugin` goes away.
- Obsidian runs this live preview on iOS, in WebKit. Tauri uses WebKit on macOS.
- `@codemirror/lang-markdown` gives a Markdown parser (lezer) and list continuation.

## Core design: plain Markdown text, layers beside it

The CodeMirror document holds the page as standard Markdown. Undertext syntax is not in it:

- An alternative shows only its active text.
- A ghost shows its text without `{-` and `-}`.
- A paragraph shows only its active version.

Three state fields hold the layers. Each is a `RangeSet` that moves with edits.

| Field    | Range                          | Value                    |
| -------- | ------------------------------ | ------------------------ |
| alts     | the active text                | id, variants, active, ai |
| ghosts   | the ghosted text               | none                     |
| versions | a point at the paragraph start | vid, variants, active    |

This is today's model. ProseMirror marks and node attributes become ranges. AI positions, word
counts and the Markdown parser all see the same clean text.

Rejected: keep `{{a|>b}}` in the CodeMirror text and hide it. Typing `|` or `}` inside an
alternative would break it. Inactive versions would sit in the text, and everything would have to
skip them.

### What ProseMirror gave for free

This is the main cost of the move. In ProseMirror the layers are part of the document. Here they
are not, so three things need explicit work.

- **Undo.** History tracks text only. Each layer change records its inverse with `invertedEffects`:
  a snapshot of the field, mapped through later edits. Deleting text that holds an alternative must
  bring the alternative back on undo.
- **Copy, cut, paste, drag.** Copy writes plain Markdown for other apps, plus a private clipboard
  type with the layers. Paste and drop read that type back and give new ids.
- **Splits and joins.** After each change, normalize the fields. An alternative can't span a line
  break: split it, and give each part its own id (as `dedupePlugin` does today). A version point
  must sit at a paragraph start. If a join moves it, drop it, as a join does today.

## File format

Changes:

- Ghost: `{-maybe cut this-}`. `~~x~~` is strikethrough.
- Undertext syntax is not read inside inline code or code blocks.
- Body text keeps its backslashes. On save, Undertext adds one only before a literal `{{` or `{-`.
  Existing `\~` and `\{` stay as written. Both are valid Markdown escapes.
- Blank lines stay as typed. They no longer collapse.
- Inside `{{ }}` the escapes stay as today: `\|`, `\}`, `\>`, `\~`, `\\`.

Unchanged: `{{a|>b}}`, `~` for AI suggestions, `:::alt` / `:::or*` / `:::`, `<!-- overflow -->`.

The format module is plain functions with no editor imports:
`parse(md) → { text, alts, ghosts, versions, overflow }`, and `serialize` back. It finds code
ranges with `@lezer/markdown`.

This fixes two known limitations: empty paragraphs collapse, and every `~` and `{` gets a
backslash.

Old files: `~~ghost~~` opens as strikethrough. There is no converter. See open decisions.

## Editing behavior

- Enter starts a new paragraph: it inserts a blank line. Shift-Enter adds a line break. This keeps
  today's feel.
- In a list or a quote, Enter continues it (`insertNewlineContinueMarkup`). Enter on an empty item
  ends the list.
- Backspace at the start of a paragraph joins it to the one above, as today.
- Blank lines between paragraphs are real lines. The cursor can stop on them.
- Use `standardKeymap` and `historyKeymap`, not `defaultKeymap`. `defaultKeymap` binds ⌘/, ⌘I and
  ⌘⇧K, which we need.

## Live preview

Parse with lezer: CommonMark plus Strikethrough, TaskList and Autolink. Don't use
`markdownLanguage`. It also reads `~x~` as subscript and `^x^` as superscript.

When syntax shows:

- Inline syntax shows when the selection touches the element, edges included.
- Line syntax (`#`, `>`, list markers) shows when the cursor is on that line.

| Element                                        | Away from the cursor                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | styled text, markers hidden                     |
| `[text](url)`                                  | link text only. ⌘-click opens it.                   |
| `# Heading`                                    | heading style, `#` hidden                           |
| `- item`, `* item`                             | a bullet. Wrapped lines indent under the text.      |
| `1. item`                                      | number kept, hanging indent                         |
| `- [ ] task`                                   | a checkbox. Click toggles it.                       |
| `> quote`                                      | a rule on the left, `>` hidden                      |
| `\*` (escape)                                  | backslash hidden                                    |
| `---`                                          | a horizontal rule                                   |
| fenced code                                    | code style, fences shown dim                        |
| tables, images, HTML                           | styled source, no rendering yet                     |

Only lines in the viewport get decorations. They rebuild when the selection moves.

## Formatting shortcuts

| Keys                         | Action                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| ⌘B                           | bold, `**`                                                   |
| ⌘I                           | italic, `*`                                                  |
| ⌘E                           | inline code                                                  |
| ⌘⇧K                          | link: wraps the selection as `[text]()`, cursor in the `()`  |
| paste a URL over a selection | makes the selection a link                                   |
| strikethrough                | command palette only. ⌘⇧X and ⌘⇧S are taken.                 |

Toggle rules:

- With a selection, wrap it. If it is already formatted, unwrap it.
- With the cursor inside formatted text, unwrap it.
- With the cursor on a word, wrap the word.
- Otherwise, insert the pair and put the cursor between.
- If the selection covers a whole alternative, put the markers outside it. Then cycling keeps the
  formatting.

## Layers in CodeMirror

- Alternatives, ghosts, Lab spans: mark decorations from the fields, with today's classes.
- Paragraph versions: a `has-versions` line decoration on each line of the paragraph.
- Dots and ink overlay: keep `drawLayer` and its DOM queries. Run it in `requestMeasure` when the
  document, selection, viewport or geometry changes. Off-screen lines are not in the DOM, but
  nothing there needs drawing.
- Hover cycling and ⌥J/K/H/L: `domEventHandlers`, with the same physical-key logic.
- a/an fix: the same function, on string offsets.
- Cursor: `drawSelection()` in the accent color. Delete `caretPlugin`.

## AI and the Lab

- Paragraphs for Claude: the blank-line blocks of the text, with their offsets. Each character
  maps to one position, as today.
- `isHeading`: read the syntax tree instead of a regex.
- Lab spans: a state field with a `DecorationSet`. Same rule: an edit inside a span drops it.
- `applyFixes`: one transaction with the text change and the alt effects. (Removed 2026-10-27, with
  "Fix punctuation and typos".)

## Phases

Each phase ends with the tests passing. Phase 1 lands on `main`. Phases 2–8 happen on a
`codemirror` branch and merge together.

1. **Ghost syntax on today's editor** (about half a day). `{-x-}` in `markdown.ts`, palette
   `plain()`, README, welcome document, tests. Style `~~x~~` as strikethrough in today's
   decorations. This ships now and does not depend on the rest.
2. **Spike, go or no-go** (1–2 days, thrown away after). CodeMirror in the Tauri app. Live preview
   of bold, italic and links. One alternative as a state field, with undo. Test in the macOS app:
   arrow keys through hidden markers, up and down, clicking into bold, accents typed with dead keys
   (´ then e), spellcheck, an IME. If the cursor misbehaves, stop and rethink.
3. **Format module** (1–2 days). Editor-independent parse and serialize. Port the round-trip tests.
   Add tests for code, escapes and blank lines.
4. **Core editor** (2–3 days). The CodeMirror view in `App.tsx`. Load, save, autosave, dirty state,
   word count. Enter, Shift-Enter, Backspace, lists. History, cursor, styles.
5. **Layers** (4–5 days, the biggest). Alt, ghost and version fields. Normalization, undo,
   clipboard and drag. The overlay, cycling and jumps. Wire up the Alternatives panel, the palette
   and the context menu. Port every test. Add do, undo and redo tests for each command.
6. **Lab and AI** (1 day).
7. **Live preview** (3 days). The rules above. Unit tests on the decoration sets, then a manual
   pass in the app.
8. **Shortcuts and polish** (1–2 days). Formatting commands and palette entries. Opening links
   (Tauri opener plugin). README and welcome document. Remove ProseMirror.

Total: about 3–4 weeks of focused work.

## Risks

- Undo of layers is subtle. Phase 5 tests do, undo and redo for every command.
- WebKit caret behavior with hidden text. The spike checks it first.
- Showing syntax shifts text sideways, also under the mouse on a click. Obsidian has the same.
- `insertNewlineContinueMarkup` may not match today's list tests (renumbering, spaces). Patch it or
  accept the difference, case by case.
- Spellcheck underlines may flicker when decorations rebuild. (Gone: WebKit's spelling is off, and
  Undertext draws its own. See "Spelling" in `docs/layout-plan.md`.)

## Decisions taken

- Enter starts a new paragraph. Shift-Enter adds a line break.
- Old `~~ghost~~` files open as strikethrough. No converter.
- The link shortcut is ⌘⇧K. The palette stays on ⌘K.
- Letters typed right after an alternative join it. A space or punctuation doesn't. (Changed after
  the move: at first, typing at its end added plain text after it.)
- `:::alt` stays for now, despite the clash with Pandoc and Docusaurus blocks.
- A drag always selects text. It never moves text.
- The right-click menu is a Mac menu (Tauri's `Menu.popup`), with our own items. The browser
  preview keeps the page's menu. Shift + right click still shows WebKit's menu.
  Tauri's per-item callbacks never reached the page, so `lib.rs` sends the chosen item's id as a
  `menu-chosen` event.
- Look Up comes after the spelling guesses, as in TextEdit. It shows the selection when the click
  is in it, else the word. A Mac menu doesn't bring Look Up by itself: WebKit's menu has it, and
  Tauri's can't add it. So `src-tauri/src/lookup.rs` calls `showDefinitionForAttributedString` on
  the webview, with the text's font and baseline so the panel draws the word in place.

## Next

As of 2026-10-26, everything above is on `main` and pushed. So are these follow-ups:

- A save guard against changes made in other apps, letters joining an alternative, and heading
  and list keys.
- The checks for working with coding agents: `pnpm verify`, CI, the end-of-turn gate, skills, and
  review checks. See `docs/agents.md`.
- Enter in a list no longer leaves a stray space in the new item.
- Tests that passed with their feature broken now fail when it breaks.

1. Try two changes in the macOS app. Neither has been tried there yet.
   - The save guard. Open a copy of a document. Change it in another editor. Switch back with no
     edits here: it should reload. Change it in the other editor again, then type here and wait
     for autosave: it should ask "Load theirs" or "Keep mine".
   - Enter in a list. With the caret after "one" in `1. one two`, Enter should give `2. two`, with
     no space before "two". The fix was tried only in the browser preview.
2. Decide how Enter renumbers a numbered list. Today it follows CommonMark: `  1. a` then
   `  2. b` then `3. c` renumbers `3. c` to `4. c`, and so does a list with a plain line
   between items. The old editor stopped at the indent change and at the plain line. These two
   cases have no tests until this is decided.
3. Tests still to write:
   - Undo and redo for each layer command. A draft covers 13 commands. `createAlt` and
     `cleanupSingleAlts` each leave an undo step that changes nothing on the page; decide whether
     that is a bug.
   - The decorations in `src/editor/preview.ts` and `src/editor/ink.ts`, and a copy and paste
     round trip in `src/editor/clipboard.ts`.
4. A script that installs the app: build, quit Undertext, and replace the bundle in
   `/Applications`.
5. Put off on purpose, until there is a reason:
   - Render tables and images. They show as Markdown source today.
   - Rename `:::alt`, if files ever go through Pandoc or Docusaurus.
   - Keep a ghost that covers only part of an alternative. Today that part is lost on save.
