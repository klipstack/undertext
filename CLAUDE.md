# Undertext

A local Markdown writing tool with layers under the text: alternatives, ghosts, paragraph
versions, Overflow, and Review, with AI checks and trims. React and CodeMirror 6 in a Tauri 2 app,
built for macOS.

What comes next, and the decisions behind the editor: the "Next" section of
`docs/codemirror-plan.md`. The side panels and Review's checks have their own plan, with its
decisions: `docs/layout-plan.md`.

## Commands

```bash
pnpm install
pnpm dev                          # the editor in a plain browser: no files, fake AI results
pnpm tauri dev                    # the desktop app, with live reload
pnpm verify                       # every check CI runs, in about 10 seconds
pnpm test                         # only the vitest tests
pnpm tauri build --bundles app    # src-tauri/target/release/bundle/macos/Undertext.app
```

`pnpm tauri` needs `cargo` on `PATH`. With Homebrew's rustup it lives in
`/opt/homebrew/opt/rustup/bin`. `pnpm verify` finds it there on its own.

## Done

- Done means proven: a test that failed before the change and passes after, or the change seen
  in the app. Reading the code or a passing compile is not proof.
- Run `pnpm verify` after each change, and before you call anything done. It records the tree
  when every check passes on it, or when only docs changed since its last pass.
- It can't see the app window (WebKit), real AI calls, file dialogs, or the keychain. When a
  change depends on them, check it in `pnpm tauri dev`, or say it is not verified.
- Never weaken a check to pass it: no test skipped or deleted to get a pass, no loosened
  assertions. If a check is wrong, stop and say why.
- At the end of a turn that changed code `pnpm verify` hasn't passed, a hook sends you back
  once. Run it, or say what is not verified and stop. `git push` and `gh pr merge` ask the
  owner first.
- Report what ran, what it showed, and what you did not verify. How this works:
  `docs/agents.md`.

## Skills

Use these without being asked. They are in `.claude/skills/`.

- `verify`: before you call any change done.
- `fix-bug`: anything broken, wrong, or a regression.
- `build-feature`: anything new.
- `refactor`: structure only, always as its own change.
- `learn`: after the owner corrects you, or when a mistake repeats.
- `review-changes`: when the owner says a change is ready, or asks for a review.

Review checks are in `.agents/checks/`, one file per concern. Any review applies the ones that fit
the change, whether an agent or a review tool runs it.

## How the editor works

- The CodeMirror document is the page as plain Markdown. Undertext's own syntax is not in it.
- `src/editor/format.ts` reads and writes the file: `{{a|>b}}` alternatives, `{-x-}` ghosts,
  `:::alt` paragraph versions, `<!-- overflow -->`. It uses only the Markdown parser, no editor
  code (`scripts/rules.test.mjs` checks).
- `src/editor/layers.ts` keeps alternatives, ghosts, and versions as ranges beside the text, in a
  state field that maps through edits. Change them only with `setLayers`, in the same transaction
  as the text. Undo restores them from a snapshot when a change touches a layer.
- `preview.ts` hides Markdown syntax away from the cursor. `keys.ts` has Enter, Backspace, and the
  formatting, heading, and list commands. `ink.ts` draws underlines, gutter lines, and dots.
  `lab.ts` holds Review's temporary marks and cuts. `highlights.ts` keeps Review's checks, and
  Claude's writing issues, and draws them while Review is open. `spelling.ts` asks the Mac's spell
  checker (`src-tauri/src/spelling.rs`) about each changed paragraph after a pause, and keeps its
  answers by paragraph text. `proofing.ts` marks punctuation mistakes as you write, with Review open or
  closed. `smart.ts` curls quotes and turns "--" into a dash as you type. `popover.ts` explains the
  mark you click and runs its fix. `clipboard.ts` keeps layers on copy and paste.
  `setup.ts` puts it together and builds the `EditorInfo` the React panels read.
- `src/prose/` is a small library of checks for English prose, for any editor: no editor code, no
  network, no packages. Code outside it imports only `src/prose/index.ts` (`scripts/rules.test.mjs`
  checks both). `readability.ts` grades a page and finds hard sentences, and gathers the marks
  `words.ts` finds (weakeners and simpler words) and `dashes.ts` finds. `markdown.ts` picks the
  prose out of a Markdown page, and `sentences.ts` splits it. `punctuation.ts` finds punctuation
  mistakes, most with one right fix. `issues.ts` holds the kinds of marks, with a title and a line
  of advice for each. `quotes.ts` curls quotes, and `articles.ts` picks "a" or "an". `checker.ts`
  keeps one page's results between edits, so an edit checks only the paragraphs it changed; the
  editor's is `pageChecker` in `highlights.ts`.
- `src/App.tsx` is the app shell. `src/appearance.ts` holds the text size, theme, and line width,
  and `App.tsx` puts them on the page as CSS variables and `data-theme`. The left panel follows the caret (`src/components/AltPanel.tsx`).
  The right panel is about the whole page: Review and Overflow (`src/components/RightPanel.tsx`).
  `src/ai/tasks.ts` turns Claude's answers into page ranges.
- The right-click menu is built in `App.tsx` and shown as a Mac menu by `src/lib/menu.ts`. The
  browser preview shows `src/components/ContextMenu.tsx` instead.
- `src-tauri/src/lib.rs`: file reads and writes (a save refuses to overwrite a change from another
  app unless told to), and `open_url` for web and mail links. `spelling.rs` wraps NSSpellChecker.
  `lookup.rs` shows the Mac's Look Up panel for a word on the page.

## Tests

- Editor tests sit beside the code, in `src/editor/*.test.ts`, and run on `EditorState` without a
  DOM. `src/editor/keys.test.ts` shows the `stateFor` and `run` helpers, with `‸` for the caret and
  `« »` for a selection. Rust tests live in each file's `mod tests`. Tooling tests are
  `scripts/*.test.mjs`; the ones that run git use `scripts/test-repo.mjs`.
- Each editor command gets a test. A command that changes layers also gets one that undoes and
  redoes it and checks the saved Markdown.
- Never take an expected value from the code under test: write the text, positions, and messages
  out, and above all any value another part relies on, such as an error code the TypeScript side
  matches. A hash or id may come from the code when another test pins that code. Then assert equal
  or not equal.
- Assert outcomes: the text, the saved Markdown, the layers, the file on disk. Check after each
  step, not only at the end.
- Never fake code in `src/` that decides the result. Stubs the test never calls are fine. The
  network is the one boundary: give the answer straight to the function that reads it, as the
  `writingIssuesFrom` tests do.
- See each new test fail once, by breaking the code or undoing the fix. Say how it failed in your
  report.
- `.only` fails `pnpm verify`. Skip a test only when it needs the network or an account, with a
  comment saying how to run it, like the `#[ignore]` test in `src-tauri/src/claude_code.rs`.
- `expect(x).not.toBeNull()` alone proves little. It's fine as a guard before using `x`, or when
  null is the failure you rule out and a nearby case pins the null, as for `matchScore`.
- Change a test's expected value only when the owner asked for the new behavior. A refactor may
  change how a test reaches the code, never its inputs or expected values.

## Conventions

- Commands return a `TransactionSpec`, or null when they don't apply.
- Docs and UI text: plain words, short sentences, active voice.
