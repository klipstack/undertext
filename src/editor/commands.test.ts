import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { lookUpRange } from "./commands";

// In these strings `‸` is the right click, and `«` `»` wrap a selection.

function lookUpAt(marked: string): string | null {
  let text = "";
  const at: Record<string, number> = {};
  for (const c of marked) {
    if (c === "‸" || c === "«" || c === "»") at[c] = text.length;
    else text += c;
  }
  const selection = "«" in at ? EditorSelection.range(at["«"], at["»"]) : EditorSelection.cursor(0);
  const state = EditorState.create({ doc: text, selection });
  const range = lookUpRange(state, at["‸"]);
  return range && text.slice(range.from, range.to);
}

describe("Look Up", () => {
  it("takes the word under the click", () => {
    expect(lookUpAt("The ‸quick fox")).toBe("quick");
    expect(lookUpAt("The qui‸ck fox")).toBe("quick");
    expect(lookUpAt("The quick‸ fox")).toBe("quick");
    expect(lookUpAt("It’s‸ fine")).toBe("It’s");
    expect(lookUpAt("A well-‸known fact")).toBe("well-known");
  });

  it("leaves out quotes, dashes, and Markdown around the word", () => {
    expect(lookUpAt("A ‘quo‸ted’ word")).toBe("quoted");
    expect(lookUpAt("Some **bo‸ld** text")).toBe("bold");
    expect(lookUpAt("- ‸item")).toBe("item");
  });

  it("has nothing for a click away from letters", () => {
    expect(lookUpAt("‸- item")).toBeNull();
    expect(lookUpAt("Page 4‸2")).toBeNull();
    expect(lookUpAt("One\n‸\nTwo")).toBeNull();
  });

  it("takes the selection when the click is in it", () => {
    expect(lookUpAt("The «quick ‸brown» fox")).toBe("quick brown");
    expect(lookUpAt("The« quick ‸»fox")).toBe("quick");
  });

  it("takes the word when the click is outside the selection", () => {
    expect(lookUpAt("«The» quick ‸fox")).toBe("fox");
  });

  it("has nothing for a selection over more than one line", () => {
    expect(lookUpAt("«One\nTw‸o»")).toBeNull();
  });
});
