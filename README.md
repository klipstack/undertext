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
  <a href="#ai-and-the-lab">AI and the Lab</a> ·
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

- **Alternatives.** A word or sentence can have several versions. Hover over it and press ↑ or ↓, or
  press ⌥J and ⌥K, to read each one in place.
- **Paragraph versions.** Fork a paragraph, rewrite it in place, and switch between the versions.
- **Ghost.** Dim text you might cut. It stays readable but easy to ignore.
- **Overflow.** A side panel for leftovers you might use later.
- **The Lab.** Optional AI help that marks, fixes, and trims, but never rewrites your text on its own.
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
| ⌘⇧G | Ask Claude for alternatives |
| ⌘⇧E | The Lab: typo fixes, checks that mark text, and trims |
| ⌥J ⌥K | Next / previous version at the cursor (word or sentence, else paragraph) |
| ⌥⇧J ⌥⇧K | Next / previous version of the paragraph |
| ⌥L ⌥H | Jump to the next / previous item that has versions (or Lab result) |
| hover + ↑ ↓ | Cycle the hovered word, sentence, or paragraph |
| ⌘⇧D | New version of the current paragraph |
| ⌘/ | Ghost the selection, or revive the ghost at the cursor |
| ⌘⇧X | Stash the selection in Overflow |
| ⌘⇧O | Open Overflow and type in it. Press again to close it. Esc goes back to the page. |
| ⌘⇧L | Show or hide the layers (same as clicking the word count) |
| ⌘O, ⌘S, ⌘⇧S, ⌘N | Open, save, save as, new |
| Right click | Context menu. Shift + right click shows the system menu with spelling fixes. |

- ⌥J, ⌥K, ⌥H, and ⌥L match the physical key, so they work on any keyboard layout. In Undertext they no
  longer type ∆ ˚ ˙ ¬. Dead keys such as ⌥E and ⌥N still work for accents and ñ.
- Hover cycling only works after you move the mouse. Typing or clicking turns it off until the mouse
  moves again, so arrow keys never cycle by accident.
- Files that have a path save automatically. Untitled documents survive restarts in local storage.
- ⌘K → "Open the welcome document" brings back the built-in tour at any time.

## File format

Plain Markdown with four small additions:

```markdown
# {{The Obvious, the Easy, and the Possible|Three Buckets}}

Much of the {{tension|pressure|>struggle}} comes from here. ~~Maybe cut this.~~

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
- `~~text~~`: ghosted text. Other Markdown tools show it as strikethrough.
- `:::alt` … `:::or` … `:::`: paragraph versions. `*` marks the active one.
- `<!-- overflow -->`: everything after this line is the Overflow panel.
- Use `\` to escape `~ { } | >`. All other Markdown stays as literal text.

## AI and the Lab

The AI features are optional. They never rewrite your text on their own: every result is something
you can see and undo.

- **Alternatives (⌘⇧G):** about 6 suggestions join the word's versions. Your current text stays.
- **Fix punctuation and typos:** each fix becomes an alternative with the fix active. ⌥K restores
  your text.
- **Checks:** weakest sentences, convoluted sentences, off-tone words, and hedges and filler. Marks
  are temporary highlights with a reason. "Sentences that run long" runs locally, without AI.
- **Trim (−10% to −50%):** Claude may only delete. Proposed cuts appear faded. Click one to keep it,
  then make the cuts, keep them as ghosts, or go back to the original.

**Privacy.** Each AI request sends your whole document to Anthropic's API. Nothing is sent until you
use an AI feature.

**Setup.** Press ⌘K, choose "Set the Anthropic API key…", and paste a key from
[platform.claude.com](https://platform.claude.com). The key is stored in the macOS Keychain, and
requests go out from the app's Rust side, so the key never reaches the web page. During development,
`ANTHROPIC_API_KEY` works too. Requests use `claude-opus-5-5`; a Lab run on a 1,000-word piece costs a
few cents.

**Or use your Claude subscription.** With no API key set, requests can go through
[Claude Code](https://claude.com/code) on your Claude plan instead. Install Claude Code and sign in by
running `claude` in a terminal, then press ⌘K, choose "Use your Claude subscription…", and confirm.
Undertext never signs you in and never uses the subscription until you choose it there; "Stop using
subscription" turns it off without signing Claude Code out. Requests count against your plan's usage
limits. If `claude` isn't in `~/.local/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`, set
`CLAUDE_PATH`. A saved API key always takes priority.

## Known limitations

- A ghost that covers only part of an alternative is lost when you save.
- Empty paragraphs collapse when you save.
- When you save, `~` and `{` in your text get a backslash (`\~`, `\{`), so they are not read as syntax.
- Autosave overwrites the file even if another editor changed it.
- Typing at the end of an alternative adds plain text after it, not to it.

## Development

```bash
pnpm test           # editor and format tests
pnpm icons          # rebuild the app icons from brand/ (needs ImageMagick)
cd src-tauri && cargo test
```

The editor is [ProseMirror](https://prosemirror.net) inside a [Tauri](https://tauri.app) app.
The icon borrows the mark of [Klipstack](brand/README.md), with a handwritten u in place of its clip.

## License

[MIT](LICENSE)
