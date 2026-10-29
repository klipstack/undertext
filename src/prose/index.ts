// Prose checks for English: readability, weakeners, simpler words, dashes, and punctuation, with
// the small rules they share, such as "a" or "an" and curly quotes. They run on Markdown or plain
// text, with no editor, no network, and no dependencies, so any editor can use them. Code outside
// this folder imports only from here.

export { startsWithVowelSound } from "./articles";
export { type Checker, createChecker } from "./checker";
export { dashesIn, hyphenDashes, pageDashStyle } from "./dashes";
export { type Issue, type Kind, type Report, KIND_ADVICE, KIND_TITLES, KINDS } from "./issues";
export { proseBlocks } from "./markdown";
export { type Mistake, checkPunctuation } from "./punctuation";
export { curlQuotes, curlyQuote } from "./quotes";
export { checkPage } from "./readability";
export { sentences } from "./sentences";
