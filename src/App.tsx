import { EditorSelection, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Appearance, pageStyle, savedAppearance, themeFor, zoom, zoomKey } from "./appearance";
import { AltPanel, AltTab } from "./components/AltPanel";
import { AiError, aiCancel, aiClearKey, aiKeyStatus, aiSetKey } from "./ai/client";
import {
  addRewrites,
  addSuggestions,
  CHECKS,
  CheckId,
  findWritingIssues,
  proposeTrim,
  runCheck,
  suggestAlternatives,
  suggestRewrites,
  TRIMS,
  TrimId,
  wordsIn,
  writingIssuesFrom,
} from "./ai/tasks";
import { CommandPalette } from "./components/CommandPalette";
import { KeyDialog } from "./components/KeyDialog";
import { SubscriptionDialog } from "./components/SubscriptionDialog";
import { LabBar } from "./components/LabBar";
import { ContextMenu, MenuItem, MenuState } from "./components/ContextMenu";
import { Icon } from "./components/Icon";
import {
  aiStatus,
  clickPanel,
  pressPanelKey,
  RightTab,
  savedHidden,
  savedPanel,
  suggestionsPending,
  toggleKinds,
} from "./components/panels";
import { RightPanel } from "./components/RightPanel";
import {
  addAltVariant,
  altAt,
  altInSelection,
  blockAt,
  cleanupSingleAlts,
  createAlt,
  dropAlt,
  findVersion,
  forkVersion,
  ghostAt,
  removeAltVariant,
  removeVersionVariant,
  reviveAt,
  setAltActive,
  setVersionActive,
  takeSelectionText,
  ghostBlocked,
  toggleGhost,
  lookUpRange,
  wordRangeAt,
} from "./editor/commands";
import { parsePage } from "./editor/format";
import { applyAllFixes, HighlightSettings, setHighlights, setWritingIssues, writingIssues } from "./editor/highlights";
import { clearLab, ghostLabNotice, ghostLabSpans, jumpToLabSpan, labSpans, labState, makeCuts, setLab } from "./editor/lab";
import { emptyLayers, layersOf, setLayers as layersEffect } from "./editor/layers";
import { Kind } from "./editor/readability";
import { jumpToMark, RewriteTarget, runFirstAction, useFixAt } from "./editor/popover";
import { createEditorState, describe, EditorHandlers, EditorInfo, pageMarkdown } from "./editor/setup";
import {
  fixSpelling,
  guessesFor,
  learnedWordAt,
  learnSpelling,
  loadGuesses,
  misspellingAt,
  misspellings,
  unlearnSpelling,
} from "./editor/spelling";
import {
  askReloadChanged,
  ChangedOnDisk,
  confirmDiscard,
  isTauri,
  openDocument,
  readDocument,
  saveDocument,
} from "./lib/files";
import { lookUp } from "./lib/lookup";
import { popupNativeMenu } from "./lib/menu";
import { speller } from "./lib/spelling";
import { buildCommands, PaletteCommand } from "./palette/commands";
import { WELCOME } from "./welcome";

const SESSION_KEY = "undertext:session";
const PREFS_KEY = "undertext:prefs";
const RECENT_KEY = "undertext:recent-commands";

interface FileRef {
  path: string | null;
  name: string;
}

interface Session extends FileRef {
  md: string;
  savedMd: string;
  /** What the file held when the page last read or wrote it. */
  disk?: string | null;
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable. The file on disk is the source of truth.
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const overflowRef = useRef("");
  const savedRef = useRef("");
  /** What the file on disk held when the page last read or wrote it. Null when unknown or unsaved. */
  const diskRef = useRef<string | null>(null);
  /** True while the "changed in another app" question is open. */
  const conflictRef = useRef(false);
  const fileRef = useRef<FileRef>({ path: null, name: "Untitled.md" });
  const toastTimer = useRef<number | undefined>(undefined);
  const paletteReturnRef = useRef<Element | null>(null);

  const [prefs] = useState(
    () =>
      readJSON<{ layers?: boolean; panel?: unknown; overflowOpen?: boolean; hidden?: unknown; textSize?: unknown; theme?: unknown; lineWidth?: unknown }>(
        PREFS_KEY,
      ) ?? {},
  );
  const [info, setInfo] = useState<EditorInfo | null>(null);
  const [overflow, setOverflowState] = useState("");
  const [file, setFileState] = useState<FileRef>(fileRef.current);
  const [dirty, setDirty] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const [layers, setLayers] = useState(prefs.layers ?? true);
  const [altOpen, setAltOpen] = useState(false);
  const [panel, setPanel] = useState<RightTab | null>(() => savedPanel(prefs));
  const [hidden, setHidden] = useState<Kind[]>(() => savedHidden(prefs));
  const [appearance, setAppearance] = useState<Appearance>(() => savedAppearance(prefs));
  const [systemLight, setSystemLight] = useState(() => matchMedia("(prefers-color-scheme: light)").matches);
  /** Highlights show while Review is open. A new editor state starts with them as they are. */
  const highlightsRef = useRef<HighlightSettings>({ on: false, hidden: [] });
  highlightsRef.current = { on: panel === "review", hidden };
  const [tab, setTab] = useState<AltTab>("inline");
  const [focusKey, setFocusKey] = useState(0);
  const [panelFocusKey, setPanelFocusKey] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readJSON<string[]>(RECENT_KEY) ?? []);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  /** The alternative the running task adds suggestions to, if any. */
  const [aiAlt, setAiAlt] = useState<string | null>(null);
  const aiRunRef = useRef(0);
  const [keyDialog, setKeyDialog] = useState<{ message?: string; hasKey: boolean } | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = useState<{ message?: string; hasKey: boolean } | null>(null);

  // -------------------------------------------------------------------------
  // Helpers

  const view = () => viewRef.current!;
  const dispatch = (spec: TransactionSpec | null | undefined) => spec && view().dispatch(spec);
  const currentMd = () => pageMarkdown(view().state, overflowRef.current);

  const flash = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };

  const setOverflow = (next: string | ((prev: string) => string)) => {
    const value = typeof next === "function" ? next(overflowRef.current) : next;
    overflowRef.current = value;
    setOverflowState(value);
    setChangeTick((t) => t + 1);
  };

  const setFile = (next: FileRef) => {
    fileRef.current = next;
    setFileState(next);
  };

  /**
   * Loads Markdown into a fresh editor state. Without `savedMd` the content
   * counts as saved. Without `disk`, a file with a path holds `md` on disk.
   */
  const loadMarkdown = (md: string, next: FileRef, savedMd?: string, disk?: string | null) => {
    // A run's answer belongs to the page it started on.
    stopAi();
    diskRef.current = disk === undefined ? (next.path ? md : null) : disk;
    const { text, alts, ghosts, versions, overflow: extra } = parsePage(md);
    const v = view();
    v.setState(createEditorState(text, { alts, ghosts, versions }, () => handlersRef.current, highlightsRef.current, speller));
    overflowRef.current = extra;
    setOverflowState(extra);
    setFile(next);
    const loaded = pageMarkdown(v.state, extra);
    savedRef.current = savedMd ?? loaded;
    setDirty(loaded !== savedRef.current);
    setInfo(describe(v.state));
    setAltOpen(false);
  };

  // -------------------------------------------------------------------------
  // Files

  /**
   * Saves, and returns whether the page is now safe to leave. If another app
   * changed the file, asks first (see resolveConflict). `force` overwrites.
   */
  const doSave = async (saveAs: boolean, md = currentMd(), force = false): Promise<boolean> => {
    try {
      const path = saveAs ? null : fileRef.current.path;
      const expected = force ? undefined : (diskRef.current ?? undefined);
      const result = await saveDocument(path, fileRef.current.name, md, expected);
      if (!result) return false;
      savedRef.current = md;
      diskRef.current = result.path ? md : null;
      setFile(result);
      setDirty(currentMd() !== md);
      writeJSON(SESSION_KEY, { ...result, md, savedMd: md, disk: diskRef.current } satisfies Session);
      if (!isTauri) flash("Saved in this browser session");
      return true;
    } catch (err) {
      if (err instanceof ChangedOnDisk) return resolveConflict();
      flash(String(err));
      return false;
    }
  };

  /** Takes the file's new text from disk, keeping the caret where it was. */
  const reloadFromDisk = (content: string) => {
    const head = view().state.selection.main.head;
    loadMarkdown(content, fileRef.current);
    view().dispatch({ selection: EditorSelection.cursor(Math.min(head, view().state.doc.length)) });
  };

  /** Another app changed the file: load their version, or keep ours and overwrite it. */
  const resolveConflict = async (): Promise<boolean> => {
    const path = fileRef.current.path;
    if (conflictRef.current || !path) return false;
    conflictRef.current = true;
    try {
      if (await askReloadChanged(fileRef.current.name)) {
        reloadFromDisk((await readDocument(path)).content);
        flash("Loaded the version from the other app");
        return true;
      }
      return await doSave(false, currentMd(), true);
    } catch (err) {
      flash(String(err));
      return false;
    } finally {
      conflictRef.current = false;
    }
  };

  /** When the window comes back: take changes made in another app, or ask if there are edits here too. */
  const checkDisk = async () => {
    const path = fileRef.current.path;
    if (!path || !isTauri || conflictRef.current || diskRef.current === null) return;
    const disk = await readDocument(path).catch(() => null);
    if (!disk || disk.content === diskRef.current || fileRef.current.path !== path) return;
    if (currentMd() !== savedRef.current) {
      await resolveConflict();
      return;
    }
    reloadFromDisk(disk.content);
    flash("Reloaded: the file changed in another app");
  };

  const okToLeave = async () => {
    if (currentMd() === savedRef.current) return true;
    if (fileRef.current.path) return doSave(false);
    return confirmDiscard();
  };

  const doOpen = async () => {
    if (!(await okToLeave())) return;
    try {
      const opened = await openDocument();
      if (opened) loadMarkdown(opened.content, { path: opened.path, name: opened.name });
    } catch (err) {
      flash(String(err));
    }
    view().focus();
  };

  const openWelcome = async () => {
    if (!(await okToLeave())) return;
    loadMarkdown(WELCOME, { path: null, name: "Welcome.md" });
    view().focus();
  };

  const doNew = async () => {
    if (!(await okToLeave())) return;
    loadMarkdown("", { path: null, name: "Untitled.md" });
    view().focus();
  };

  // -------------------------------------------------------------------------
  // Editor actions

  const openAlternatives = () => {
    const v = view();
    const { state } = v;
    const sel = state.selection.main;
    const block = blockAt(state);
    setAltOpen(true);
    if (!sel.empty && block && sel.from <= block.from && sel.to >= block.to) {
      setTab("paragraph");
      return;
    }
    setTab("inline");
    if (!altInSelection(state)) {
      const range = sel.empty ? wordRangeAt(state, sel.from) : { from: sel.from, to: sel.to };
      const created = range ? createAlt(state, range.from, range.to) : null;
      if (created) v.dispatch(created.spec);
    }
    setFocusKey((k) => k + 1);
  };

  const closeAlternatives = () => {
    dispatch(cleanupSingleAlts(view().state));
    setAltOpen(false);
    view().focus();
  };

  // -------------------------------------------------------------------------
  // AI and the Lab

  const openKeyDialog = async (message?: string) => {
    setKeyDialog({ message, hasKey: await aiKeyStatus().catch(() => false) });
  };

  const openSubscriptionDialog = async (message?: string) => {
    setSubscriptionDialog({ message, hasKey: await aiKeyStatus().catch(() => false) });
  };

  /** A rejected key goes back to the key dialog; with no key, offer the subscription first. */
  const openAiSetup = async (message: string) => {
    const hasKey = await aiKeyStatus().catch(() => false);
    if (hasKey) setKeyDialog({ message, hasKey });
    else setSubscriptionDialog({ message, hasKey });
  };

  /**
   * Runs one AI task at a time. Cancelling makes its result be ignored.
   * `alt` is the alternative it adds suggestions to, so the panel can show them coming.
   */
  const runAi = async (label: string, work: (live: () => boolean) => Promise<void>, alt?: string) => {
    if (aiBusy) {
      flash(`Still working: ${aiBusy}`);
      return;
    }
    const run = ++aiRunRef.current;
    const live = () => aiRunRef.current === run && viewRef.current !== null;
    setAiBusy(label);
    setAiAlt(alt ?? null);
    try {
      await work(live);
    } catch (err) {
      if (!live()) return;
      if (err instanceof AiError && err.code === "no_key") void openAiSetup(err.message);
      else flash(err instanceof Error ? err.message : String(err));
    } finally {
      if (aiRunRef.current === run) {
        setAiBusy(null);
        setAiAlt(null);
      }
    }
  };

  /** Stops the AI run, if any, and drops its result. */
  const stopAi = () => {
    void aiCancel().catch(() => {});
    aiRunRef.current++;
    setAiBusy(null);
    setAiAlt(null);
  };

  const cancelAi = () => {
    stopAi();
    flash("Cancelled");
  };

  const aiAlternatives = () => {
    openAlternatives();
    const r = altInSelection(view().state);
    if (!r) {
      flash("Put the cursor on a word or select a phrase first");
      return;
    }
    const { id } = r;
    void runAi(
      "Finding other ways to say it",
      async (live) => {
        const texts = await suggestAlternatives(view().state, id);
        if (!live()) return;
        const spec = addSuggestions(view().state, id, texts);
        if (spec) dispatch(spec);
        else flash("No new alternatives");
      },
      id,
    );
  };

  const findIssues = () =>
    void runAi("Finding writing issues", async (live) => {
      const answers = await findWritingIssues(view().state);
      if (!live()) return;
      // A fix the Mac suggests for a misspelled word is in its spelling mark already.
      const words = misspellings(view().state).filter((w) => answers.some((a) => a.find.includes(w.word)));
      await Promise.all(words.map((w) => loadGuesses(view(), w).catch(() => [])));
      if (!live()) return;
      const issues = writingIssuesFrom(view().state, answers);
      dispatch(setWritingIssues(issues));
      // The marks show only while Review is open.
      if (issues.length) showPanel("review");
      view().focus();
      const n = issues.length;
      flash(n ? `${n} writing ${n === 1 ? "issue" : "issues"} marked in pink` : "No writing issues found");
    });

  /** "Use all": every writing issue's fix that fits, in one change. */
  const useAllFixes = () => {
    const used = applyAllFixes(view().state);
    if (used) dispatch(used.spec);
    view().focus();
    if (!used) {
      flash("No fixes to use");
      return;
    }
    const left = writingIssues(view().state)?.length ?? 0;
    const fixes = `${used.count} ${used.count === 1 ? "fix" : "fixes"}`;
    flash(`Used ${fixes}. ⌘Z brings your words back.${left ? ` ${left} left to look at.` : ""}`);
  };

  /** Uses the fix of the mark at the caret: a mistake is replaced, a suggestion becomes an alternative. */
  const useFix = () => {
    const state = view().state;
    const spec = useFixAt(state);
    if (spec) dispatch(spec);
    view().focus();
  };

  const check = (id: CheckId) => {
    const c = CHECKS.find((x) => x.id === id)!;
    void runAi(c.title, async (live) => {
      const spans = await runCheck(view().state, id);
      if (!live()) return;
      view().focus();
      if (!spans.length) {
        dispatch(clearLab());
        flash(`${c.label}: nothing to mark`);
        return;
      }
      dispatch(setLab("marks", { label: c.label }, spans));
    });
  };

  const trim = (id: TrimId) => {
    const t = TRIMS.find((x) => x.id === id)!;
    void runAi(`${t.label}: choosing cuts`, async (live) => {
      const spans = await proposeTrim(view().state, t.percent);
      if (!live()) return;
      view().focus();
      if (!spans.length) {
        flash("Nothing to cut");
        return;
      }
      dispatch(setLab("cuts", { label: t.label, percent: t.percent }, spans));
    });
  };

  const walkLab = () => {
    view().focus();
    dispatch(jumpToLabSpan(view().state, 1));
  };

  const finishLab = (spec: TransactionSpec | null) => {
    dispatch(spec);
    view().focus();
  };

  /** "Keep as ghosts": marks on part of an alternative stay marks, and the bar says how many. */
  const ghostLab = () => {
    const notice = ghostLabNotice(view().state);
    finishLab(ghostLabSpans(view().state));
    if (notice) flash(notice);
  };

  const stash = () => {
    const taken = takeSelectionText(view().state);
    if (!taken) {
      flash("Select some text to stash it");
      return;
    }
    dispatch(taken.spec);
    const text = taken.text.trim();
    setOverflow((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
    setPanel("overflow");
  };

  /** ⌘+ ⌘− ⌘0: the page's text size. */
  const zoomText = (step: 1 | -1 | 0) => {
    const next = zoom(appearance.textSize, step);
    setAppearance((a) => ({ ...a, textSize: next.size }));
    flash(next.notice);
  };

  const toggleLayers = () => {
    setLayers(!layers);
    flash(layers ? "Layers hidden. ⌘⇧L shows them." : "Layers shown");
  };

  /** Shows a tab of the right panel, and with `focus` moves the focus into it. Null closes the panel and goes back to the page. */
  const showPanel = (next: RightTab | null, focus = false) => {
    setPanel(next);
    if (!next) view().focus();
    else if (focus) setPanelFocusKey((k) => k + 1);
  };

  /** ⌘⇧E and ⌘⇧O: show that tab and focus it. Pressed again from inside it, close the panel. */
  const pressPanel = (key: RightTab) => {
    const inside = panel && panelRef.current?.contains(document.activeElement) ? panel : null;
    const next = pressPanelKey(key, inside);
    showPanel(next.panel, next.focus === "panel");
  };

  // -------------------------------------------------------------------------
  // Command palette (⌘K)

  const openPalette = () => {
    paletteReturnRef.current = document.activeElement;
    setMenu(null);
    setPaletteOpen(true);
  };

  const closePalette = () => {
    setPaletteOpen(false);
    const back = paletteReturnRef.current;
    if (back instanceof HTMLElement && back !== document.body && !view().dom.contains(back)) back.focus();
    else view().focus();
  };

  const runCommand = (command: PaletteCommand) => {
    setPaletteOpen(false);
    if (!command.dynamic) {
      const next = [command.id, ...recent.filter((id) => id !== command.id)].slice(0, 8);
      setRecent(next);
      writeJSON(RECENT_KEY, next);
    }
    view().focus();
    // Teach the shortcut. A command's own message, if any, replaces this one.
    if (command.shortcut && command.shortcut !== "esc") flash(`Tip: ${command.shortcut} does this without the menu`);
    command.run();
  };

  const fork = () => {
    const v = view();
    const block = blockAt(v.state);
    if (!block) return;
    dispatch(forkVersion(v.state, block.from));
    const n = findVersion(v.state, block.from)?.variants.length ?? 1;
    flash(`Version ${n} of ${n}. Edit it in place. ⌥⇧J ⌥⇧K switches.`);
    v.focus();
  };

  const placeCaret = (pos: number) => {
    view().dispatch({ selection: EditorSelection.cursor(pos) });
  };

  /**
   * Claude's rewrites of a marked sentence, as an alternative's variants, from the popover or ⌥↩.
   * Only rewrites that fix what the mark is about join it.
   */
  const rewrite = ({ from, to, kind, phrase }: RewriteTarget) => {
    const made = createAlt(view().state, from, to);
    if (!made) {
      flash("This text can't become an alternative");
      return;
    }
    view().dispatch({ ...made.spec, selection: EditorSelection.cursor(from) });
    openAlternatives();
    void runAi(
      "Finding other ways to say it",
      async (live) => {
        const texts = await suggestRewrites(view().state, made.id, kind, phrase);
        if (!live()) return;
        const spec = addRewrites(view().state, made.id, kind, texts);
        if (spec) dispatch(spec);
        // Each one kept the issue, added a dash, or repeated a version the sentence has.
        else flash("No new rewrites that fix it. Try again.");
      },
      made.id,
    );
  };

  /** Ghosts or revives the selection from a menu, or says why it can't, as ⌘/ does. */
  const ghost = () => {
    const v = view();
    const why = ghostBlocked(v.state);
    if (why) flash(why);
    else toggleGhost(v);
    v.focus();
  };

  const handlersRef = useRef<EditorHandlers>(null!);
  handlersRef.current = {
    notice: flash,
    alternatives: openAlternatives,
    aiAlternatives,
    rewrite,
    lab: () => pressPanel("review"),
    stash,
    fork,
    escape: () => {
      if (aiBusy) {
        cancelAi();
        return true;
      }
      if (labState(view().state).kind === "marks") {
        finishLab(clearLab());
        return true;
      }
      if (!altOpen) return false;
      closeAlternatives();
      return true;
    },
  };

  // -------------------------------------------------------------------------
  // Context menu

  /** Page text quoted for a menu label, cut short. */
  const quoted = (text: string) => `“${text.length > 18 ? `${text.slice(0, 18)}…` : text}”`;

  /** `learned` is the word at `at` when it's in the Mac's own word list. */
  const buildMenu = (at: number | null, x: number, y: number, learned: string | null): MenuState | null => {
    const v = view();
    const { state } = v;
    const sel = state.selection.main;
    const items: MenuItem[] = [];
    const hasSelection = !sel.empty && (at === null || (at >= sel.from && at <= sel.to));

    // A misspelled word's guesses come first, as in other Mac apps.
    const misspelled = !hasSelection && at !== null ? misspellingAt(state, at) : null;
    if (misspelled) {
      const fixable = fixSpelling(state, misspelled, misspelled.word) !== null;
      for (const guess of fixable ? (guessesFor(state, misspelled.word) ?? []).slice(0, 5) : []) {
        items.push({ label: guess, run: () => dispatch(fixSpelling(v.state, misspelled, guess)) });
      }
      items.push({ label: "Learn spelling", run: () => dispatch(learnSpelling(misspelled.word)) });
    } else if (learned && !hasSelection) {
      items.push({ label: "Unlearn spelling", run: () => dispatch(unlearnSpelling(learned)) });
    }
    const spellingItems = items.length;

    // Look Up comes next, as in other Mac apps. The browser preview has no Look Up.
    const lookUpSpan = isTauri && at !== null ? lookUpRange(state, at) : null;
    if (lookUpSpan) {
      items.push({
        label: `Look Up ${quoted(state.doc.sliceString(lookUpSpan.from, lookUpSpan.to))}`,
        run: () => void lookUp(v, lookUpSpan).catch((err) => console.warn("Look Up failed:", err)),
      });
    }
    const lookUpItems = items.length;

    if (hasSelection) {
      const ghosted = layersOf(state).ghosts.some((g) => g.from < sel.to && g.to > sel.from);
      items.push(
        { label: "Alternatives for selection", shortcut: "⌘⇧A", run: openAlternatives },
        { label: "Suggest other ways", shortcut: "⌘⇧G", run: aiAlternatives },
        {
          label: ghosted ? "Revive" : "Ghost it",
          shortcut: "⌘/",
          run: ghost,
        },
        { label: "Stash in Overflow", shortcut: "⌘⇧X", run: stash },
      );
    } else if (at !== null) {
      if (ghostAt(state, at)) {
        items.push({ label: "Revive", shortcut: "⌘/", run: () => dispatch(reviveAt(v.state, at)) });
      }
      const altRange = altAt(state, at);
      if (altRange) {
        items.push(
          {
            label: "Show alternatives",
            shortcut: "⌘⇧A",
            run: () => {
              placeCaret(at);
              openAlternatives();
            },
          },
          {
            label: "Remove alternatives",
            run: () => dispatch(dropAlt(v.state, altRange.id)),
          },
        );
      } else {
        const word = wordRangeAt(state, at);
        if (word) {
          items.push({
            label: `Alternatives for ${quoted(state.doc.sliceString(word.from, word.to))}`,
            shortcut: "⌘⇧A",
            run: () => {
              v.dispatch({ selection: EditorSelection.range(word.from, word.to) });
              openAlternatives();
            },
          });
        }
      }
    }
    if (at !== null) {
      items.push({
        label: "New paragraph version",
        shortcut: "⌘⇧D",
        run: () => {
          if (!hasSelection) placeCaret(at);
          fork();
        },
      });
    }
    items.push({ label: "All commands…", shortcut: "⌘K", run: openPalette });
    for (const start of [spellingItems, lookUpItems]) if (start > 0 && items[start]) items[start].divider = true;
    return { x, y, items };
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    const v = viewRef.current;
    if (e.shiftKey || !v || !v.dom.contains(e.target as Node)) return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const at = v.posAtCoords({ x, y });
    // Let the editor see the selection change from the right click first. A misspelled word's
    // guesses take a few milliseconds to come, the first time.
    window.setTimeout(async () => {
      const word = at === null ? null : misspellingAt(v.state, at);
      if (word) await loadGuesses(v, word).catch((err) => console.warn("Spelling guesses failed:", err));
      const learned = at === null || word ? null : await learnedWordAt(v, at).catch(() => null);
      const menu = buildMenu(at, x, y, learned);
      if (!menu) return;
      if (!isTauri) return setMenu(menu);
      // A Mac menu, drawn by the system. Our own menu stands in if it fails.
      popupNativeMenu(menu).catch((err) => {
        console.warn("The Mac menu failed:", err);
        setMenu(menu);
      });
    }, 0);
  };

  // -------------------------------------------------------------------------
  // Effects

  useEffect(() => {
    const v = new EditorView({
      parent: mountRef.current!,
      state: createEditorState("", emptyLayers, () => handlersRef.current, highlightsRef.current, speller),
      dispatchTransactions(trs, view) {
        view.update(trs);
        setInfo(describe(view.state));
        // Layers live beside the text, so changing one is a change to the file too.
        if (trs.some((tr) => tr.docChanged || tr.effects.some((e) => e.is(layersEffect)))) setChangeTick((t) => t + 1);
      },
    });
    viewRef.current = v;
    if (import.meta.env.DEV) Object.assign(window, { __view: v });

    (async () => {
      const session = readJSON<Session>(SESSION_KEY);
      if (session?.path && isTauri && session.md === session.savedMd) {
        try {
          const f = await readDocument(session.path);
          if (viewRef.current !== v) return;
          loadMarkdown(f.content, { path: f.path, name: f.name });
          v.focus();
          return;
        } catch {
          // The file moved or vanished. Fall back to the session copy.
        }
      }
      if (viewRef.current !== v) return;
      if (session) loadMarkdown(session.md, { path: session.path, name: session.name }, session.savedMd, session.disk ?? null);
      else loadMarkdown(WELCOME, { path: null, name: "Welcome.md" });
      v.focus();
    })();

    return () => {
      viewRef.current = null;
      v.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a session copy, track dirty state, and autosave files that have a path.
  useEffect(() => {
    if (!changeTick) return;
    const timer = window.setTimeout(() => {
      if (!viewRef.current) return;
      const md = currentMd();
      const isDirty = md !== savedRef.current;
      setDirty(isDirty);
      writeJSON(SESSION_KEY, { ...fileRef.current, md, savedMd: savedRef.current, disk: diskRef.current } satisfies Session);
      if (isDirty && fileRef.current.path && isTauri) void doSave(false, md);
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeTick]);

  useEffect(() => writeJSON(PREFS_KEY, { layers, panel, hidden, ...appearance }), [layers, panel, hidden, appearance]);

  // The page's text size, line width, and colors, set before the page paints.
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(pageStyle(appearance))) root.style.setProperty(name, value);
    root.dataset.theme = themeFor(appearance.theme, systemLight);
    viewRef.current?.requestMeasure();
  }, [appearance, systemLight]);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystemLight(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  // The title bar and the window's buttons follow the theme too. Null follows the system.
  useEffect(() => {
    if (!isTauri) return;
    getCurrentWindow()
      .setTheme(appearance.theme === "system" ? null : appearance.theme)
      .catch((err) => console.warn("Window theme failed:", err));
  }, [appearance.theme]);
  useEffect(() => {
    viewRef.current?.dispatch(setHighlights({ on: panel === "review", hidden }));
  }, [panel, hidden]);

  useEffect(() => {
    if (panelFocusKey) panelRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [panelFocusKey]);

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const step = zoomKey(e);
    if (step !== null) {
      e.preventDefault();
      zoomText(step);
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void doSave(e.shiftKey);
    } else if (key === "o" && e.shiftKey) {
      e.preventDefault();
      pressPanel("overflow");
    } else if (key === "l" && e.shiftKey) {
      e.preventDefault();
      toggleLayers();
    } else if (key === "o") {
      e.preventDefault();
      void doOpen();
    } else if (key === "n" && !e.shiftKey) {
      e.preventDefault();
      void doNew();
    } else if (key === "e" && e.shiftKey) {
      e.preventDefault();
      pressPanel("review");
    } else if (key === "k" && !e.shiftKey) {
      e.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focusRef = useRef<() => void>(() => {});
  focusRef.current = () => void checkDisk();
  useEffect(() => {
    const onFocus = () => focusRef.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // -------------------------------------------------------------------------
  // Render

  const words = info?.words ?? 0;
  const altPending = suggestionsPending(aiAlt, { open: altOpen, tab, alt: info?.alt?.id });

  return (
    <div className={`app${layers ? " layers" : ""}`}>
      <header className="topbar" data-tauri-drag-region>
        <button
          className="quiet count"
          onClick={() => showPanel(clickPanel(panel, "review"))}
          title="Review (⌘⇧E)"
          aria-pressed={panel === "review"}
        >
          {words} {words === 1 ? "word" : "words"}
          {info?.checks?.grade != null && ` · grade ${info.checks.grade}`}
          <span className="chars"> · {info?.chars ?? 0} chars</span>
        </button>
        <span className="filename" data-tauri-drag-region>
          {file.name.replace(/\.md$/, "")}
          {dirty && <span className="dirty"> •</span>}
        </span>
        <span className="topbar-end" data-tauri-drag-region />
      </header>

      <div className="body">
        {altOpen && info && (
          <AltPanel
            info={info}
            tab={tab}
            focusKey={focusKey}
            inputRef={inputRef}
            onTab={setTab}
            onActivate={(i) => info.alt && dispatch(setAltActive(view().state, info.alt.id, i))}
            onAdd={(text) => {
              let id = altInSelection(view().state)?.id;
              if (!id && info.candidate) {
                const created = createAlt(view().state, info.candidate.from, info.candidate.to);
                if (!created) return;
                dispatch(created.spec);
                id = created.id;
              }
              if (id) dispatch(addAltVariant(view().state, id, text));
            }}
            onRemove={(i) => info.alt && dispatch(removeAltVariant(view().state, info.alt.id, i))}
            onParaActivate={(i) => info.para && dispatch(setVersionActive(view().state, info.para.at, i))}
            onParaRemove={(i) => info.para && dispatch(removeVersionVariant(view().state, info.para.at, i))}
            onFork={fork}
            onClose={closeAlternatives}
            onAi={aiAlternatives}
            onCancel={cancelAi}
            aiBusy={aiBusy !== null}
            aiPending={altPending}
          />
        )}

        <main className="page" onContextMenu={onContextMenu}>
          <div className="column" ref={mountRef} />
          {info?.lab && (
            <LabBar
              lab={info.lab}
              words={info.words}
              cutWords={info.lab.kind === "cuts" ? wordsIn(view().state, labSpans(view().state)) : 0}
              onWalk={walkLab}
              onCut={() => finishLab(makeCuts(view().state))}
              onGhost={ghostLab}
              onClear={() => finishLab(clearLab())}
            />
          )}
        </main>

        {panel && (
          <RightPanel
            tab={panel}
            panelRef={panelRef}
            overflow={overflow}
            busy={aiBusy}
            checks={info?.checks ?? null}
            words={words}
            hidden={hidden}
            onToggle={(kinds) => setHidden((h) => toggleKinds(h, kinds))}
            onJump={(kinds) => {
              dispatch(jumpToMark(view().state, kinds, 1));
              view().focus();
            }}
            onTab={(next) => showPanel(next, true)}
            onOverflow={setOverflow}
            onFindIssues={findIssues}
            onUseFix={useFix}
            onUseAll={useAllFixes}
            onCheck={check}
            onTrim={trim}
            onCancel={cancelAi}
            onPage={() => view().focus()}
          />
        )}
      </div>

      <footer className="bottombar">
        <div className="group">
          <button
            className={`icon${altOpen ? " on" : ""}`}
            onClick={() => (altOpen ? closeAlternatives() : openAlternatives())}
            title="Alternatives (⌘⇧A)"
            aria-pressed={altOpen}
          >
            <Icon name="alts" />
          </button>
          <button className="icon" onClick={() => void doOpen()} title="Open (⌘O)">
            <Icon name="open" />
          </button>
          <button className="icon" onClick={() => void doSave(false)} title="Save (⌘S)">
            <Icon name="save" />
          </button>
        </div>
        <div className="toast" aria-live="polite">
          {toast ?? aiStatus(aiBusy, panel, altPending)}
        </div>
        <div className="group">
          <button className="icon wide" onClick={openPalette} title="All commands (⌘K)">
            ⌘K
          </button>
          <button
            className={`icon wide${panel === "review" ? " on" : ""}`}
            onClick={() => showPanel(clickPanel(panel, "review"))}
            title="Review (⌘⇧E)"
            aria-pressed={panel === "review"}
          >
            Review
          </button>
          <button
            className={`icon${panel === "overflow" ? " on" : ""}`}
            onClick={() => showPanel(clickPanel(panel, "overflow"))}
            title="Overflow (⌘⇧O)"
            aria-pressed={panel === "overflow"}
          >
            <Icon name="overflow" />
          </button>
        </div>
      </footer>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}

      {keyDialog && (
        <KeyDialog
          hasKey={keyDialog.hasKey}
          message={keyDialog.message}
          onSave={async (key) => {
            await aiSetKey(key);
            setKeyDialog(null);
            flash("Key saved in the Keychain");
            view().focus();
          }}
          onRemove={async () => {
            await aiClearKey();
            setKeyDialog(null);
            flash("Key removed");
            view().focus();
          }}
          onClose={() => {
            setKeyDialog(null);
            view().focus();
          }}
        />
      )}

      {subscriptionDialog && (
        <SubscriptionDialog
          hasKey={subscriptionDialog.hasKey}
          message={subscriptionDialog.message}
          onEnabled={() => {
            flash(subscriptionDialog.hasKey ? "Saved. Your API key still comes first." : "Using your Claude subscription");
            setSubscriptionDialog(null);
            view().focus();
          }}
          onDisabled={() => {
            setSubscriptionDialog(null);
            flash("Stopped using your Claude subscription");
            view().focus();
          }}
          onUseKey={() => {
            setSubscriptionDialog(null);
            void openKeyDialog();
          }}
          onClose={() => {
            setSubscriptionDialog(null);
            view().focus();
          }}
        />
      )}

      {paletteOpen && info && (
        <CommandPalette
          commands={buildCommands({
            view: view(),
            info,
            layers,
            appearance,
            overflowOpen: panel === "overflow",
            reviewOpen: panel === "review",
            altOpen,
            actions: {
              save: (saveAs) => void doSave(saveAs),
              open: () => void doOpen(),
              newDoc: () => void doNew(),
              welcome: () => void openWelcome(),
              toggleLayers,
              setOverflowOpen: (open) => showPanel(open ? "overflow" : null, true),
              setReviewOpen: (open) => showPanel(open ? "review" : null, true),
              openAlternatives,
              closeAlternatives,
              stash,
              fork,
              aiAlternatives,
              findIssues,
              useFix,
              useAllFixes,
              check,
              trim,
              walkLab,
              makeCuts: () => finishLab(makeCuts(view().state)),
              ghostLab,
              ghost,
              firstAction: () => {
                runFirstAction(view());
                view().focus();
              },
              clearLab: () => finishLab(clearLab()),
              setKey: () => void openKeyDialog(),
              connectSubscription: () => void openSubscriptionDialog(),
              zoom: zoomText,
              setTheme: (theme) => setAppearance((a) => ({ ...a, theme })),
              setLineWidth: (lineWidth) => setAppearance((a) => ({ ...a, lineWidth })),
            },
          })}
          recent={recent}
          onRun={runCommand}
          onClose={closePalette}
        />
      )}
    </div>
  );
}
