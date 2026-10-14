import { MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { TextSelection, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { AltPanel, AltTab } from "./components/AltPanel";
import { AiError, aiClearKey, aiKeyStatus, aiSetKey } from "./ai/client";
import {
  applyFixes,
  CHECKS,
  CheckId,
  findFixes,
  proposeTrim,
  runCheck,
  suggestAlternatives,
  TRIMS,
  TrimId,
  wordsIn,
} from "./ai/tasks";
import { CommandPalette } from "./components/CommandPalette";
import { KeyDialog } from "./components/KeyDialog";
import { SubscriptionDialog } from "./components/SubscriptionDialog";
import { LabBar } from "./components/LabBar";
import { LabMenu } from "./components/LabMenu";
import { ContextMenu, MenuItem, MenuState } from "./components/ContextMenu";
import { Icon } from "./components/Icon";
import {
  addAiAlternatives,
  addAltVariant,
  altAtPos,
  altInSelection,
  cleanupSingleAlts,
  createAlt,
  forkParagraph,
  markRangeAt,
  paragraphAt,
  removeAltVariant,
  removeParagraphVariant,
  reviveAt,
  setAltActive,
  setParagraphActive,
  takeSelectionText,
  toggleGhost,
  wordRangeAt,
} from "./editor/commands";
import { clearLab, ghostLabSpans, jumpToLabSpan, labSpans, labState, makeCuts, setLab } from "./editor/lab";
import { parseFile, serializeFile } from "./editor/markdown";
import { schema } from "./editor/schema";
import { createState, describe, EditorHandlers, EditorInfo } from "./editor/setup";
import { confirmDiscard, isTauri, openDocument, readDocument, saveDocument } from "./lib/files";
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
  const overflowInputRef = useRef<HTMLTextAreaElement>(null);
  const overflowRef = useRef("");
  const savedRef = useRef("");
  const fileRef = useRef<FileRef>({ path: null, name: "Untitled.md" });
  const toastTimer = useRef<number | undefined>(undefined);
  const paletteReturnRef = useRef<Element | null>(null);

  const [prefs] = useState(() => readJSON<{ layers?: boolean; overflowOpen?: boolean }>(PREFS_KEY) ?? {});
  const [info, setInfo] = useState<EditorInfo | null>(null);
  const [overflow, setOverflowState] = useState("");
  const [file, setFileState] = useState<FileRef>(fileRef.current);
  const [dirty, setDirty] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const [layers, setLayers] = useState(prefs.layers ?? true);
  const [altOpen, setAltOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(prefs.overflowOpen ?? false);
  const [tab, setTab] = useState<AltTab>("inline");
  const [focusKey, setFocusKey] = useState(0);
  const [overflowFocusKey, setOverflowFocusKey] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readJSON<string[]>(RECENT_KEY) ?? []);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const aiRunRef = useRef(0);
  const [labOpen, setLabOpen] = useState(false);
  const [keyDialog, setKeyDialog] = useState<{ message?: string; hasKey: boolean } | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = useState<{ message?: string; hasKey: boolean } | null>(null);

  // -------------------------------------------------------------------------
  // Helpers

  const view = () => viewRef.current!;
  const dispatch = (tr: Transaction | null | undefined) => tr && view().dispatch(tr);
  const currentMd = () => serializeFile(view().state.doc, overflowRef.current);

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

  /** Loads Markdown into a fresh editor state. Without `savedMd` the content counts as saved. */
  const loadMarkdown = (md: string, next: FileRef, savedMd?: string) => {
    const { doc, overflow: extra } = parseFile(md);
    const v = view();
    v.updateState(createState(doc, () => handlersRef.current));
    overflowRef.current = extra;
    setOverflowState(extra);
    setFile(next);
    savedRef.current = savedMd ?? serializeFile(doc, extra);
    setDirty(serializeFile(doc, extra) !== savedRef.current);
    setInfo(describe(v.state));
    setAltOpen(false);
  };

  // -------------------------------------------------------------------------
  // Files

  const doSave = async (saveAs: boolean, md = currentMd()) => {
    try {
      const result = await saveDocument(saveAs ? null : fileRef.current.path, fileRef.current.name, md);
      if (!result) return;
      savedRef.current = md;
      setFile(result);
      setDirty(currentMd() !== md);
      writeJSON(SESSION_KEY, { ...result, md, savedMd: md } satisfies Session);
      if (!isTauri) flash("Saved in this browser session");
    } catch (err) {
      flash(String(err));
    }
  };

  const okToLeave = async () => {
    if (currentMd() === savedRef.current) return true;
    if (fileRef.current.path) {
      await doSave(false);
      return true;
    }
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
    const sel = state.selection;
    const p = paragraphAt(state);
    setAltOpen(true);
    if (!sel.empty && p && sel.from <= p.pos + 1 && sel.to >= p.pos + p.node.nodeSize - 1) {
      setTab("paragraph");
      return;
    }
    setTab("inline");
    if (!altInSelection(state)) {
      const range = sel.empty ? wordRangeAt(state.doc, sel.from) : { from: sel.from, to: sel.to };
      const created = range ? createAlt(state, range.from, range.to) : null;
      if (created?.tr.docChanged) v.dispatch(created.tr);
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
    if (await aiKeyStatus().catch(() => false)) void openKeyDialog(message);
    else void openSubscriptionDialog(message);
  };

  /** Runs one AI task at a time. Cancelling makes its result be ignored. */
  const runAi = async (label: string, work: (live: () => boolean) => Promise<void>) => {
    if (aiBusy) {
      flash(`Still working: ${aiBusy}`);
      return;
    }
    const run = ++aiRunRef.current;
    const live = () => aiRunRef.current === run && viewRef.current !== null;
    setAiBusy(label);
    try {
      await work(live);
    } catch (err) {
      if (!live()) return;
      if (err instanceof AiError && err.code === "no_key") void openAiSetup(err.message);
      else flash(err instanceof Error ? err.message : String(err));
    } finally {
      if (aiRunRef.current === run) setAiBusy(null);
    }
  };

  const cancelAi = () => {
    aiRunRef.current++;
    setAiBusy(null);
    flash("Cancelled");
  };

  const aiAlternatives = () => {
    openAlternatives();
    const r = altInSelection(view().state);
    if (!r) {
      flash("Put the cursor on a word or select a phrase first");
      return;
    }
    const id = r.mark.attrs.id as string;
    void runAi("Suggesting alternatives", async (live) => {
      const texts = await suggestAlternatives(view().state, id);
      if (!live()) return;
      const tr = addAiAlternatives(view().state, id, texts);
      if (tr) dispatch(tr);
      else flash("No new alternatives");
    });
  };

  const closeLab = () => {
    setLabOpen(false);
    view().focus();
  };

  const fixTypos = () =>
    void runAi("Checking typos and punctuation", async (live) => {
      const fixes = await findFixes(view().state);
      if (!live()) return;
      const { tr, count } = applyFixes(view().state, fixes);
      closeLab();
      if (!count) {
        flash("No typos found");
        return;
      }
      dispatch(tr);
      flash(`${count} ${count === 1 ? "fix" : "fixes"} added as alternatives. ⌥L visits each. ⌥K restores your text.`);
    });

  const check = (id: CheckId) => {
    const c = CHECKS.find((x) => x.id === id)!;
    void runAi(c.title, async (live) => {
      const spans = await runCheck(view().state, id);
      if (!live()) return;
      closeLab();
      if (!spans.length) {
        dispatch(clearLab(view().state.tr));
        flash(`${c.label}: nothing to mark`);
        return;
      }
      dispatch(setLab(view().state.tr, "marks", { label: c.label }, spans));
    });
  };

  const trim = (id: TrimId) => {
    const t = TRIMS.find((x) => x.id === id)!;
    void runAi(`${t.label}: choosing cuts`, async (live) => {
      const spans = await proposeTrim(view().state, t.percent);
      if (!live()) return;
      closeLab();
      if (!spans.length) {
        flash("Nothing to cut");
        return;
      }
      dispatch(setLab(view().state.tr, "cuts", { label: t.label, percent: t.percent }, spans));
    });
  };

  const walkLab = () => {
    view().focus();
    dispatch(jumpToLabSpan(view().state, 1));
  };

  const finishLab = (tr: Transaction | null) => {
    dispatch(tr);
    view().focus();
  };

  const stash = () => {
    const taken = takeSelectionText(view().state);
    if (!taken) {
      flash("Select some text to stash it");
      return;
    }
    dispatch(taken.tr.scrollIntoView());
    const text = taken.text.trim();
    setOverflow((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
    setOverflowOpen(true);
  };

  const toggleLayers = () => {
    setLayers(!layers);
    flash(layers ? "Layers hidden. ⌘⇧L shows them." : "Layers shown");
  };

  /** ⌘⇧O: open Overflow and type in it. Pressed again from Overflow, close it and go back to the page. */
  const toggleOverflow = () => {
    if (!overflowOpen) {
      setOverflowOpen(true);
      setOverflowFocusKey((k) => k + 1);
    } else if (document.activeElement === overflowInputRef.current) {
      setOverflowOpen(false);
      view().focus();
    } else {
      overflowInputRef.current?.focus();
    }
  };

  const showOverflow = (open: boolean) => {
    setOverflowOpen(open);
    if (open) setOverflowFocusKey((k) => k + 1);
    else view().focus();
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
    const p = paragraphAt(v.state);
    if (!p) return;
    dispatch(forkParagraph(v.state, p.pos));
    const n: number = v.state.doc.nodeAt(p.pos)?.attrs.variants?.length ?? 1;
    flash(`Version ${n} of ${n}. Edit it in place. ⌥⇧J ⌥⇧K switches.`);
    v.focus();
  };

  const placeCaret = (pos: number) => {
    const v = view();
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  };

  const handlersRef = useRef<EditorHandlers>(null!);
  handlersRef.current = {
    alternatives: openAlternatives,
    aiAlternatives,
    lab: () => setLabOpen((o) => !o),
    stash,
    fork,
    escape: () => {
      if (aiBusy) {
        cancelAi();
        return true;
      }
      if (labState(view().state).kind === "marks") {
        finishLab(clearLab(view().state.tr));
        return true;
      }
      if (!altOpen) return false;
      closeAlternatives();
      return true;
    },
  };

  // -------------------------------------------------------------------------
  // Context menu

  const buildMenu = (at: number | null, x: number, y: number): MenuState | null => {
    const v = view();
    const { state } = v;
    const sel = state.selection;
    const items: MenuItem[] = [];
    const hasSelection = !sel.empty && (at === null || (at >= sel.from && at <= sel.to));

    if (hasSelection) {
      const ghosted = state.doc.rangeHasMark(sel.from, sel.to, schema.marks.ghost);
      items.push(
        { label: "Alternatives for selection", shortcut: "⌘⇧A", run: openAlternatives },
        { label: "AI alternatives for selection", shortcut: "⌘⇧G", run: aiAlternatives },
        {
          label: ghosted ? "Revive" : "Ghost it",
          shortcut: "⌘/",
          run: () => {
            toggleGhost(v.state, v.dispatch);
            v.focus();
          },
        },
        { label: "Stash in Overflow", shortcut: "⌘⇧X", run: stash },
      );
    } else if (at !== null) {
      if (markRangeAt(state.doc, at, schema.marks.ghost)) {
        items.push({ label: "Revive", shortcut: "⌘/", run: () => dispatch(reviveAt(v.state, at)) });
      }
      const altRange = altAtPos(state.doc, at);
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
            run: () => dispatch(v.state.tr.removeMark(altRange.from, altRange.to, schema.marks.alt)),
          },
        );
      } else {
        const word = wordRangeAt(state.doc, at);
        if (word) {
          const text = state.doc.textBetween(word.from, word.to);
          items.push({
            label: `Alternatives for “${text.length > 18 ? `${text.slice(0, 18)}…` : text}”`,
            shortcut: "⌘⇧A",
            run: () => {
              v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, word.from, word.to)));
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
    return { x, y, items };
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    const v = viewRef.current;
    if (e.shiftKey || !v || !v.dom.contains(e.target as Node)) return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const at = v.posAtCoords({ left: x, top: y })?.pos ?? null;
    // Let the editor see the selection change from the right click first.
    window.setTimeout(() => setMenu(buildMenu(at, x, y)), 0);
  };

  // -------------------------------------------------------------------------
  // Effects

  useEffect(() => {
    const v = new EditorView(mountRef.current!, {
      state: createState(parseFile("").doc, () => handlersRef.current),
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        setInfo(describe(next));
        if (tr.docChanged) setChangeTick((t) => t + 1);
      },
      attributes: { spellcheck: "true", class: "page-text" },
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
      if (session) loadMarkdown(session.md, { path: session.path, name: session.name }, session.savedMd);
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
      writeJSON(SESSION_KEY, { ...fileRef.current, md, savedMd: savedRef.current } satisfies Session);
      if (isDirty && fileRef.current.path && isTauri) void doSave(false, md);
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeTick]);

  useEffect(() => writeJSON(PREFS_KEY, { layers, overflowOpen }), [layers, overflowOpen]);

  useEffect(() => {
    if (overflowFocusKey) overflowInputRef.current?.focus();
  }, [overflowFocusKey]);

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void doSave(e.shiftKey);
    } else if (key === "o" && e.shiftKey) {
      e.preventDefault();
      toggleOverflow();
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
      if (labOpen) closeLab();
      else setLabOpen(true);
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

  // -------------------------------------------------------------------------
  // Render

  const words = info?.words ?? 0;

  return (
    <div className={`app${layers ? " layers" : ""}`}>
      <header className="topbar" data-tauri-drag-region>
        <button
          className="quiet count"
          onClick={toggleLayers}
          title={layers ? "Hide the layers (⌘⇧L)" : "Show the layers (⌘⇧L)"}
          aria-pressed={layers}
        >
          {words} {words === 1 ? "word" : "words"}
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
              let id = altInSelection(view().state)?.mark.attrs.id as string | undefined;
              if (!id && info.candidate) {
                const created = createAlt(view().state, info.candidate.from, info.candidate.to);
                if (!created) return;
                dispatch(created.tr);
                id = created.id;
              }
              if (id) dispatch(addAltVariant(view().state, id, text));
            }}
            onRemove={(i) => info.alt && dispatch(removeAltVariant(view().state, info.alt.id, i))}
            onParaActivate={(i) => info.para && dispatch(setParagraphActive(view().state, info.para.pos, i))}
            onParaRemove={(i) => info.para && dispatch(removeParagraphVariant(view().state, info.para.pos, i))}
            onFork={fork}
            onClose={closeAlternatives}
            onAi={aiAlternatives}
            aiBusy={aiBusy === "Suggesting alternatives"}
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
              onGhost={() => finishLab(ghostLabSpans(view().state))}
              onClear={() => finishLab(clearLab(view().state.tr))}
            />
          )}
        </main>

        {overflowOpen && (
          <aside className="side side-right" aria-label="Overflow">
            <header className="side-title">Overflow</header>
            <textarea
              ref={overflowInputRef}
              className="overflow"
              value={overflow}
              onChange={(e) => setOverflow(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  view().focus();
                }
              }}
              placeholder="Extra writing, notes, leftovers…"
              spellCheck
            />
            <footer className="side-hint">⌘⇧X stashes selection · esc back to the page · ⌘⇧O closes</footer>
          </aside>
        )}
      </div>

      <footer className="bottombar">
        <div className="group">
          <button className="icon" onClick={() => void doOpen()} title="Open (⌘O)">
            <Icon name="open" />
          </button>
          <button className="icon" onClick={() => void doSave(false)} title="Save (⌘S)">
            <Icon name="save" />
          </button>
        </div>
        <div className="toast" aria-live="polite">
          {toast ?? (aiBusy && !labOpen ? `${aiBusy}… (esc cancels)` : null)}
        </div>
        <div className="group">
          <button
            className={`icon wide${labOpen ? " on" : ""}`}
            onClick={() => (labOpen ? closeLab() : setLabOpen(true))}
            title="The Lab (⌘⇧E)"
            aria-pressed={labOpen}
          >
            Lab
          </button>
          <button className="icon wide" onClick={openPalette} title="All commands (⌘K)">
            ⌘K
          </button>
          <button
            className={`icon${altOpen ? " on" : ""}`}
            onClick={() => (altOpen ? closeAlternatives() : openAlternatives())}
            title="Alternatives (⌘⇧A)"
            aria-pressed={altOpen}
          >
            <Icon name="alts" />
          </button>
          <button
            className={`icon${overflowOpen ? " on" : ""}`}
            onClick={() => setOverflowOpen((o) => !o)}
            title="Overflow (⌘⇧O)"
            aria-pressed={overflowOpen}
          >
            <Icon name="overflow" />
          </button>
        </div>
      </footer>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}

      {labOpen && (
        <LabMenu busy={aiBusy} onFix={fixTypos} onCheck={check} onTrim={trim} onCancel={cancelAi} onClose={closeLab} />
      )}

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
            setSubscriptionDialog(null);
            flash("Using your Claude subscription");
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
            overflowOpen,
            altOpen,
            actions: {
              save: (saveAs) => void doSave(saveAs),
              open: () => void doOpen(),
              newDoc: () => void doNew(),
              welcome: () => void openWelcome(),
              toggleLayers,
              setOverflowOpen: showOverflow,
              openAlternatives,
              closeAlternatives,
              stash,
              fork,
              aiAlternatives,
              openLab: () => setLabOpen(true),
              fixTypos,
              check,
              trim,
              walkLab,
              makeCuts: () => finishLab(makeCuts(view().state)),
              ghostLab: () => finishLab(ghostLabSpans(view().state)),
              clearLab: () => finishLab(clearLab(view().state.tr)),
              setKey: () => void openKeyDialog(),
              connectSubscription: () => void openSubscriptionDialog(),
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
