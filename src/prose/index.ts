// Prose checks for English: readability, weakeners, simpler words, dashes, and punctuation. They run
// on Markdown or plain text, with no editor, no network, and no dependencies, so any editor can use
// them. Code outside this folder imports only from here.

export { type Mistake, checkPunctuation } from "./punctuation";
export {
  type Issue,
  type Kind,
  type Report,
  checkPage,
  dashesIn,
  hyphenDashes,
  KINDS,
  pageDashStyle,
  proseBlocks,
  sentences,
} from "./readability";
