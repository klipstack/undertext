// Prose checks for English: readability, weakeners, simpler words, dashes, and punctuation. They run
// on Markdown or plain text, with no editor, no network, and no dependencies, so any editor can use
// them. Code outside this folder imports only from here.

export { dashesIn, hyphenDashes, pageDashStyle } from "./dashes";
export { type Issue, type Kind, type Report, KINDS } from "./issues";
export { proseBlocks } from "./markdown";
export { type Mistake, checkPunctuation } from "./punctuation";
export { checkPage } from "./readability";
export { sentences } from "./sentences";
