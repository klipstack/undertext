import { REVIEW_KINDS, ReviewKind } from "../editor/highlights";
import type { AltTab } from "./AltPanel";

/** The right panel's tabs. The panel shows one at a time. */
export type RightTab = "review" | "overflow";

/**
 * ⌘⇧E (Review) or ⌘⇧O (Overflow). Pressed inside that tab, it closes the panel and goes back
 * to the page. Anywhere else, it shows the tab and focuses it.
 */
export function pressPanelKey(tab: RightTab, focusedIn: RightTab | null): { panel: RightTab | null; focus: "panel" | "page" } {
  return focusedIn === tab ? { panel: null, focus: "page" } : { panel: tab, focus: "panel" };
}

/** A click on a tab's button: show the tab, or close the panel when it already shows. */
export function clickPanel(panel: RightTab | null, tab: RightTab): RightTab | null {
  return panel === tab ? null : tab;
}

/** The tab open last time. Older prefs only kept whether Overflow was open. */
export function savedPanel(prefs: { panel?: unknown; overflowOpen?: boolean }): RightTab | null {
  if (prefs.panel === "review" || prefs.panel === "overflow") return prefs.panel;
  if (prefs.panel === undefined && prefs.overflowOpen) return "overflow";
  return null;
}

/** An eye toggle: hides the kinds, or shows them again when all of them are hidden. */
export function toggleKinds(hidden: readonly ReviewKind[], kinds: readonly ReviewKind[]): ReviewKind[] {
  if (kinds.every((k) => hidden.includes(k))) return hidden.filter((k) => !kinds.includes(k));
  return [...hidden, ...kinds.filter((k) => !hidden.includes(k))];
}

/**
 * Whether the left panel shows suggestions on their way: its Word or Sentence tab is open on the
 * alternative the running task fills. `fills` is that alternative's id, null when no task fills one.
 */
export function suggestionsPending(fills: string | null, panel: { open: boolean; tab: AltTab; alt: string | undefined }): boolean {
  return panel.open && panel.tab === "inline" && panel.alt === fills;
}

/** The toolbar's status for the running task, unless Review or the left panel already shows it. */
export function aiStatus(running: string | null, panel: RightTab | null, pending: boolean): string | null {
  return running && panel !== "review" && !pending ? `${running}… (esc cancels)` : null;
}

/** Esc in the left panel: cancel the running task, or close the panel when nothing runs. */
export function altPanelEscape(busy: boolean): "cancel" | "close" {
  return busy ? "cancel" : "close";
}

/** The left panel's key hints. While suggestions load, the line under the button says Esc cancels. */
export function altPanelHint(tab: AltTab, busy: boolean, pending: boolean): string {
  const keys = tab === "inline" ? "return adds · ↑↓ cycles" : "⌘⇧D new version · ⌥⇧J ⌥⇧K cycles";
  if (pending) return keys;
  return `${keys} · ${busy ? "esc cancels" : "esc closes"}`;
}

/** The highlight kinds hidden last time. */
export function savedHidden(prefs: { hidden?: unknown }): ReviewKind[] {
  const known: readonly unknown[] = REVIEW_KINDS;
  return Array.isArray(prefs.hidden) ? prefs.hidden.filter((k): k is ReviewKind => known.includes(k)) : [];
}
