import { undoDepth, redoDepth, undo, redo } from "prosemirror-history";
import { TextSelection, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  cycleAtCaret,
  cycleParagraphAtCaret,
  deleteGhosts,
  dropAlt,
  hasGhosts,
  jumpToItem,
  markRangeAt,
  reviveAll,
  setAltActive,
  setParagraphActive,
  settleAll,
  settleParagraph,
  toggleGhost,
  versionedItems,
} from "../editor/commands";
import { CHECKS, CheckId, TRIMS, TrimId } from "../ai/tasks";
import { schema } from "../editor/schema";
import { EditorInfo } from "../editor/setup";

export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  keywords?: string;
  /** Built from the current document, like "Use “pressure”". Not kept in Recent. */
  dynamic?: boolean;
  run(): void;
}

export interface PaletteContext {
  view: Pick<EditorView, "state" | "dispatch">;
  info: EditorInfo;
  layers: boolean;
  overflowOpen: boolean;
  altOpen: boolean;
  actions: {
    save(saveAs: boolean): void;
    open(): void;
    newDoc(): void;
    welcome(): void;
    toggleLayers(): void;
    setOverflowOpen(open: boolean): void;
    openAlternatives(): void;
    closeAlternatives(): void;
    stash(): void;
    fork(): void;
    aiAlternatives(): void;
    openLab(): void;
    fixTypos(): void;
    check(id: CheckId): void;
    trim(id: TrimId): void;
    walkLab(): void;
    makeCuts(): void;
    ghostLab(): void;
    clearLab(): void;
    setKey(): void;
    connectSubscription(): void;
  };
}

/** Group order when the query is empty. The most contextual groups come first. */
export const GROUPS = ["Alternatives", "Lab", "Paragraph", "Ghost", "Overflow", "Go to", "View", "Document", "Edit", "Settings"];

const quote = (text: string, max = 36) => `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;
/** Inline Markdown to display text: the active variant of each alternative, no ghost markers. */
const plain = (md: string) =>
  md
    .replace(/\{\{([^}]*)\}\}/g, (_, body: string) => {
      const parts = body.split("|");
      return (parts.find((p) => p.trimStart().startsWith(">")) ?? parts[0]).replace(/^\s*>/, "").trim();
    })
    .replace(/~~|\\/g, "");

/** Everything you can do right now, given where the caret is. */
export function buildCommands(ctx: PaletteContext): PaletteCommand[] {
  const { view, info, actions } = ctx;
  const { state } = view;
  const sel = state.selection;
  const apply = (tr: Transaction | null) => tr && view.dispatch(tr.scrollIntoView());
  const out: PaletteCommand[] = [];
  const add = (cmd: PaletteCommand) => out.push(cmd);

  // Alternatives for the word or sentence at the caret
  if (info.alt && info.alt.variants.length > 1) {
    const { id, variants, active } = info.alt;
    add({
      id: "alt.show",
      group: "Alternatives",
      title: `Show alternatives for ${quote(variants[active])}`,
      shortcut: "⌘⇧A",
      keywords: "panel variants versions synonyms",
      run: actions.openAlternatives,
    });
    add({ id: "alt.next", group: "Alternatives", title: "Next alternative", shortcut: "⌥J", run: () => apply(cycleAtCaret(view.state, 1)) });
    add({ id: "alt.prev", group: "Alternatives", title: "Previous alternative", shortcut: "⌥K", run: () => apply(cycleAtCaret(view.state, -1)) });
    variants.forEach((v, i) => {
      if (i === active) return;
      add({
        id: `alt.use.${i}`,
        dynamic: true,
        group: "Alternatives",
        title: `Use ${quote(v)}`,
        keywords: i === 0 ? "original" : "variant",
        run: () => apply(setAltActive(view.state, id, i)),
      });
    });
    add({
      id: "alt.keep",
      group: "Alternatives",
      title: `Keep ${quote(variants[active])}, drop the other alternatives`,
      keywords: "accept settle remove clear choose",
      run: () => apply(dropAlt(view.state, id)),
    });
  } else if (info.candidate) {
    add({
      id: "alt.add",
      group: "Alternatives",
      title: `Add alternatives for ${quote(info.candidate.text)}`,
      shortcut: "⌘⇧A",
      keywords: "variants versions synonyms word sentence",
      run: actions.openAlternatives,
    });
  }
  const aiTarget = info.alt ? info.alt.variants[info.alt.active] : info.candidate?.text;
  if (aiTarget) {
    add({
      id: "alt.ai",
      group: "Alternatives",
      title: `Suggest alternatives for ${quote(aiTarget)} with AI`,
      shortcut: "⌘⇧G",
      keywords: "claude ideas synonyms words",
      run: actions.aiAlternatives,
    });
  }

  // The Lab: results first, then the tools
  if (info.lab?.kind === "cuts") {
    add({ id: "lab.walk", group: "Lab", title: "Next proposed cut", shortcut: "⌥L", keywords: "trim walk through review", run: actions.walkLab });
    add({ id: "lab.cut", group: "Lab", title: "Make the cuts", keywords: "trim delete apply", run: actions.makeCuts });
    add({ id: "lab.ghostCuts", group: "Lab", title: "Keep the proposed cuts as ghosts", keywords: "trim dim later", run: actions.ghostLab });
    add({ id: "lab.discard", group: "Lab", title: "Discard the trim (back to the original)", keywords: "cancel undo original", run: actions.clearLab });
  } else if (info.lab?.kind === "marks") {
    add({ id: "lab.next", group: "Lab", title: "Next mark", shortcut: "⌥L", keywords: "review walk", run: actions.walkLab });
    add({ id: "lab.ghostMarks", group: "Lab", title: "Ghost the marked text", keywords: "dim cut", run: actions.ghostLab });
    add({ id: "lab.clear", group: "Lab", title: "Clear the marks", shortcut: "esc", keywords: "remove hide", run: actions.clearLab });
  }
  add({ id: "lab.open", group: "Lab", title: "Open the Lab", shortcut: "⌘⇧E", keywords: "ai claude tools checks", run: actions.openLab });
  add({ id: "lab.typos", group: "Lab", title: "Fix punctuation and typos", keywords: "ai spelling proofread grammar", run: actions.fixTypos });
  for (const c of CHECKS) {
    add({ id: `lab.check.${c.id}`, group: "Lab", title: c.title, keywords: c.ai ? "ai check review" : "check review", run: () => actions.check(c.id) });
  }
  for (const t of TRIMS) {
    add({
      id: `lab.trim.${t.id}`,
      group: "Lab",
      title: `${t.label} (cut about ${t.percent}%)`,
      keywords: "ai trim shorten tighten cut",
      run: () => actions.trim(t.id),
    });
  }

  // Paragraph versions
  if (info.para) {
    const { pos, variants, active } = info.para;
    add({
      id: "para.fork",
      group: "Paragraph",
      title: "New version of this paragraph",
      shortcut: "⌘⇧D",
      keywords: "fork duplicate copy rewrite variant",
      run: actions.fork,
    });
    if (variants.length > 1) {
      add({ id: "para.next", group: "Paragraph", title: "Next paragraph version", shortcut: "⌥⇧J", run: () => apply(cycleParagraphAtCaret(view.state, 1)) });
      add({ id: "para.prev", group: "Paragraph", title: "Previous paragraph version", shortcut: "⌥⇧K", run: () => apply(cycleParagraphAtCaret(view.state, -1)) });
      variants.forEach((v, i) => {
        if (i === active) return;
        add({
          id: `para.use.${i}`,
          dynamic: true,
          group: "Paragraph",
          title: `Switch to version ${i + 1}: ${quote(plain(v), 40)}`,
          keywords: i === 0 ? "original" : "variant",
          run: () => apply(setParagraphActive(view.state, pos, i)),
        });
      });
      add({
        id: "para.keep",
        group: "Paragraph",
        title: "Keep this version, drop the other paragraph versions",
        keywords: "accept settle remove clear choose",
        run: () => apply(settleParagraph(view.state, pos)),
      });
    }
  }

  // Ghost
  if (!sel.empty) {
    const ghosted = state.doc.rangeHasMark(sel.from, sel.to, schema.marks.ghost);
    add({
      id: ghosted ? "ghost.revive" : "ghost.add",
      group: "Ghost",
      title: ghosted ? "Revive the selection" : "Ghost the selection",
      shortcut: "⌘/",
      keywords: "dim fade hide maybe cut",
      run: () => toggleGhost(view.state, view.dispatch),
    });
  } else if (markRangeAt(state.doc, sel.from, schema.marks.ghost)) {
    add({ id: "ghost.revive", group: "Ghost", title: "Revive this ghosted text", shortcut: "⌘/", keywords: "undim restore show", run: () => toggleGhost(view.state, view.dispatch) });
  }
  if (hasGhosts(state.doc)) {
    add({ id: "ghost.reviveAll", group: "Ghost", title: "Revive all ghosted text", keywords: "undim restore show", run: () => apply(reviveAll(view.state)) });
    add({ id: "ghost.cut", group: "Ghost", title: "Delete all ghosted text", keywords: "make the cuts trim remove", run: () => apply(deleteGhosts(view.state)) });
  }

  // Overflow
  if (!sel.empty) {
    add({ id: "overflow.stash", group: "Overflow", title: "Stash the selection in Overflow", shortcut: "⌘⇧X", keywords: "move keep later", run: actions.stash });
  }
  add({
    id: "overflow.toggle",
    group: "Overflow",
    title: ctx.overflowOpen ? "Close Overflow" : "Open Overflow",
    shortcut: "⌘⇧O",
    keywords: "sidebar panel notes leftovers",
    run: () => actions.setOverflowOpen(!ctx.overflowOpen),
  });

  // Go to
  const items = versionedItems(state.doc);
  if (items.length) {
    add({ id: "goto.next", group: "Go to", title: "Next word or paragraph with versions", shortcut: "⌥L", keywords: "jump navigate", run: () => apply(jumpToItem(view.state, 1, null)?.tr ?? null) });
    add({ id: "goto.prev", group: "Go to", title: "Previous word or paragraph with versions", shortcut: "⌥H", keywords: "jump navigate", run: () => apply(jumpToItem(view.state, -1, null)?.tr ?? null) });
    for (const item of items) {
      const text = item.kind === "alt" ? state.doc.textBetween(item.from, item.to) : state.doc.textBetween(item.from, item.to, " ");
      add({
        id: `goto.${item.from}`,
        dynamic: true,
        group: "Go to",
        title: item.kind === "alt" ? `Go to ${quote(text)}` : `Go to paragraph ${quote(text, 40)}`,
        keywords: "jump navigate",
        run: () => apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, item.from))),
      });
    }
  }

  // View
  add({ id: "view.layers", group: "View", title: ctx.layers ? "Hide layers" : "Show layers", shortcut: "⌘⇧L", keywords: "underlines dots focus clean", run: actions.toggleLayers });
  add({
    id: "view.alternatives",
    group: "View",
    title: ctx.altOpen ? "Close the Alternatives panel" : "Open the Alternatives panel",
    shortcut: ctx.altOpen ? "esc" : "⌘⇧A",
    keywords: "sidebar panel",
    run: ctx.altOpen ? actions.closeAlternatives : actions.openAlternatives,
  });

  // Document
  add({ id: "doc.new", group: "Document", title: "New document", shortcut: "⌘N", keywords: "file create blank", run: actions.newDoc });
  add({
    id: "doc.welcome",
    group: "Document",
    title: "Open the welcome document",
    keywords: "help guide tutorial intro shortcuts reset start",
    run: actions.welcome,
  });
  add({ id: "doc.open", group: "Document", title: "Open…", shortcut: "⌘O", keywords: "file load", run: actions.open });
  add({ id: "doc.save", group: "Document", title: "Save", shortcut: "⌘S", keywords: "file write", run: () => actions.save(false) });
  add({ id: "doc.saveAs", group: "Document", title: "Save as…", shortcut: "⌘⇧S", keywords: "file write copy", run: () => actions.save(true) });
  if (items.length) {
    add({
      id: "doc.settle",
      group: "Document",
      title: "Accept all current choices",
      keywords: "settle finalize publish clean drop alternatives versions",
      run: () => apply(settleAll(view.state)),
    });
  }

  // Settings
  add({ id: "settings.key", group: "Settings", title: "Set the Anthropic API key…", keywords: "ai claude token keychain", run: actions.setKey });
  add({ id: "settings.subscription", group: "Settings", title: "Use your Claude subscription…", keywords: "ai claude code login account plan pro max", run: actions.connectSubscription });

  // Edit
  if (undoDepth(state) > 0) add({ id: "edit.undo", group: "Edit", title: "Undo", shortcut: "⌘Z", run: () => undo(view.state, view.dispatch) });
  if (redoDepth(state) > 0) add({ id: "edit.redo", group: "Edit", title: "Redo", shortcut: "⌘⇧Z", run: () => redo(view.state, view.dispatch) });

  return out;
}
