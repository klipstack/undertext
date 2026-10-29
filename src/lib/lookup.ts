import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import type { Span } from "../editor/format";

/**
 * Shows the Mac's Look Up panel for the text in `span`, through src-tauri/src/lookup.rs. The panel
 * draws the text again over the page, so it needs the text's font and where its baseline starts.
 */
export async function lookUp(view: EditorView, span: Span): Promise<void> {
  const start = view.coordsAtPos(span.from, 1);
  const { node } = view.domAtPos(span.from + 1);
  const element = node instanceof Element ? node : node.parentElement;
  if (!start || !element) return;
  const style = getComputedStyle(element);
  const text = view.state.doc.sliceString(span.from, span.to);
  // The text's box starts at the font's ascent above the baseline.
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ascent = context.measureText(text).fontBoundingBoxAscent;
  await invoke("look_up", {
    text,
    x: start.left,
    y: start.top + ascent,
    font: {
      family: style.fontFamily,
      size: parseFloat(style.fontSize),
      bold: parseInt(style.fontWeight, 10) >= 600,
      italic: style.fontStyle !== "normal",
    },
  });
}
