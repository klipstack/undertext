// Curly quotes for straight ones, as you type them or in text that has them.

/**
 * The curly quote for a straight one, `typed`, after `before`. It opens at the start, after a space,
 * an opening bracket or quote, or a ">", as of a quote marker or a tag, and closes otherwise; an
 * apostrophe is a closing quote. Emphasis marks don't count: *"Hi"* opens after the *.
 */
export function curlyQuote(before: string, typed: string): string {
  const prev = before.replace(/[*_~]+$/, "").at(-1);
  const opens = prev === undefined || /[\s([{“‘>]/.test(prev);
  return typed === '"' ? (opens ? "“" : "”") : opens ? "‘" : "’";
}

/** Curly quotes for the straight ones in `text`, by the same rules as typing them. */
export function curlQuotes(text: string): string {
  let out = "";
  for (const c of text) out += c === '"' || c === "'" ? curlyQuote(out, c) : c;
  return out;
}
