import { describe, expect, it } from "vitest";
import {
  aiStatus,
  altPanelEscape,
  altPanelHint,
  clickPanel,
  pressPanelKey,
  savedHidden,
  savedPanel,
  suggestionsPending,
  toggleKinds,
} from "./panels";

describe("the right panel", () => {
  it("opens a tab from its key and focuses it, from the page or the other tab", () => {
    expect(pressPanelKey("review", null)).toEqual({ panel: "review", focus: "panel" });
    expect(pressPanelKey("overflow", null)).toEqual({ panel: "overflow", focus: "panel" });
    expect(pressPanelKey("review", "overflow")).toEqual({ panel: "review", focus: "panel" });
    expect(pressPanelKey("overflow", "review")).toEqual({ panel: "overflow", focus: "panel" });
  });

  it("closes from inside the tab its key opens, and goes back to the page", () => {
    expect(pressPanelKey("review", "review")).toEqual({ panel: null, focus: "page" });
    expect(pressPanelKey("overflow", "overflow")).toEqual({ panel: null, focus: "page" });
  });

  it("toggles a tab from its button", () => {
    expect(clickPanel(null, "review")).toBe("review");
    expect(clickPanel("review", "review")).toBe(null);
    expect(clickPanel("overflow", "review")).toBe("review");
    expect(clickPanel("review", "overflow")).toBe("overflow");
  });

  it("reopens the tab from last time, and reads older prefs", () => {
    expect(savedPanel({ panel: "review" })).toBe("review");
    expect(savedPanel({ panel: "overflow" })).toBe("overflow");
    expect(savedPanel({ panel: null, overflowOpen: true })).toBe(null);
    expect(savedPanel({ overflowOpen: true })).toBe("overflow");
    expect(savedPanel({ overflowOpen: false })).toBe(null);
    expect(savedPanel({ panel: "lab" })).toBe(null);
    expect(savedPanel({})).toBe(null);
  });
});

describe("Review's eye toggles", () => {
  it("hide a kind, or show it again", () => {
    expect(toggleKinds([], ["adverb"])).toEqual(["adverb"]);
    expect(toggleKinds(["adverb", "hard"], ["adverb"])).toEqual(["hard"]);
  });

  it("hide a whole group unless all of it is hidden, then show it all", () => {
    const group = ["adverb", "passive", "filler"] as const;
    expect(toggleKinds(["adverb", "hard"], group)).toEqual(["adverb", "hard", "passive", "filler"]);
    expect(toggleKinds(["adverb", "hard", "passive", "filler"], group)).toEqual(["hard"]);
  });

  it("come back from prefs, without kinds this version doesn't know", () => {
    expect(savedHidden({ hidden: ["adverb", "weasel", 3, "simpler"] })).toEqual(["adverb", "simpler"]);
    // With none saved, adverbs start hidden, as in Hemingway. A saved choice to show them stays.
    expect(savedHidden({ hidden: "adverb" })).toEqual(["adverb"]);
    expect(savedHidden({})).toEqual(["adverb"]);
    expect(savedHidden({ hidden: [] })).toEqual([]);
    // Claude's writing issues are a kind of Review's own, not of the prose checks.
    expect(savedHidden({ hidden: ["grammar", "cliche"] })).toEqual(["grammar", "cliche"]);
  });
});

describe("suggestions on their way", () => {
  const shown = { open: true, tab: "inline" as const, alt: "alt-1" };

  it("show in the left panel while it shows the alternative they fill", () => {
    expect(suggestionsPending("alt-1", shown)).toBe(true);
    expect(suggestionsPending("alt-1", { ...shown, alt: "alt-2" })).toBe(false);
    expect(suggestionsPending("alt-1", { ...shown, alt: undefined })).toBe(false);
    expect(suggestionsPending("alt-1", { ...shown, tab: "paragraph" })).toBe(false);
    expect(suggestionsPending("alt-1", { ...shown, open: false })).toBe(false);
    // A task that fills no alternative, such as finding writing issues.
    expect(suggestionsPending(null, shown)).toBe(false);
  });

  it("show in the toolbar when no panel shows them", () => {
    expect(aiStatus("Finding other ways to say it", null, false)).toBe("Finding other ways to say it… (esc cancels)");
    expect(aiStatus("Finding other ways to say it", "overflow", false)).toBe("Finding other ways to say it… (esc cancels)");
    expect(aiStatus("Finding other ways to say it", null, true)).toBe(null);
    expect(aiStatus("Finding writing issues", "review", false)).toBe(null);
    expect(aiStatus(null, null, false)).toBe(null);
  });

  it("can be cancelled with Esc in the left panel, which closes it when nothing runs", () => {
    expect(altPanelEscape(true)).toBe("cancel");
    expect(altPanelEscape(false)).toBe("close");
  });

  it("change what the left panel's hints say Esc does", () => {
    expect(altPanelHint("inline", false, false)).toBe("return adds · ↑↓ cycles · esc closes");
    expect(altPanelHint("inline", true, false)).toBe("return adds · ↑↓ cycles · esc cancels");
    // The line under the button says it.
    expect(altPanelHint("inline", true, true)).toBe("return adds · ↑↓ cycles");
    expect(altPanelHint("paragraph", false, false)).toBe("⌘⇧D new version · ⌥⇧J ⌥⇧K cycles · esc closes");
    expect(altPanelHint("paragraph", true, false)).toBe("⌘⇧D new version · ⌥⇧J ⌥⇧K cycles · esc cancels");
  });
});
