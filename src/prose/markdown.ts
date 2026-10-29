// The prose in a Markdown page: paragraphs, list items, and quotes, with the markup blanked out.

/** Lines that hold no prose: headings, rules, tables, HTML, and link definitions. */
const NOT_PROSE = /^ {0,3}(?:#{1,6}(?:\s|$)|([-*_])(?:\s*\1){2,}\s*$|=+\s*$|\||<|\[[^\]]+\]:\s)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A line under a paragraph that makes it a heading. */
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const INDENTED = /^(?: {4}|\t)/;
const QUOTE = /^\s*(?:>\s?)*/;
const ITEM = /^(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
/** Inline markup that holds no prose: code, images, link addresses, HTML tags, and bare URLs. */
const INLINE = /(`+)[\s\S]*?\1|!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|<[^>\n]*>|\bhttps?:\/\/\S+/g;

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** Tags whose HTML block runs to a closing tag, even across blank lines. */
const RAW_HTML = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;
/** Tags whose HTML block runs to a blank line, as CommonMark has them. */
const BLOCK_HTML =
  /^ {0,3}<\/?(?:address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|legend|li|main|menu|nav|ol|optgroup|option|p|search|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?=[\s/>]|$)/i;
/** Any other tag alone on its line. */
const LONE_TAG = /^ {0,3}<\/?[a-z][\w-]*(?:\s[^>]*)?\/?>\s*$/i;

/**
 * Where the HTML block that `line` starts ends: at a line that matches, or "blank" at a blank line.
 * Null when the line starts none, or ends it on the same line.
 */
function htmlBlock(line: string, inParagraph: boolean): RegExp | "blank" | null {
  if (/^ {0,3}<!--/.test(line)) return line.includes("-->", line.indexOf("<!--") + 4) ? null : /-->/;
  const raw = RAW_HTML.exec(line);
  if (raw) return new RegExp(`</${raw[1]}>`, "i").test(line) ? null : new RegExp(`</${raw[1]}>`, "i");
  if (BLOCK_HTML.test(line) || (!inParagraph && LONE_TAG.test(line))) return "blank";
  return null;
}

/** A heading line, and the marks around its text: "## Title ##". */
const ATX = /^ {0,3}#{1,6}(?=\s|$)|[ \t]#+[ \t]*$/g;

/**
 * Splits the page into paragraphs, list items, and quotes, and with `headings`, headings too. Each
 * block's text has the same length as the page text it covers, with markup blanked out, so an
 * offset in it is an offset in the page.
 */
export function proseBlocks(page: string, { headings = false } = {}): { from: number; text: string }[] {
  const blocks: { from: number; text: string }[] = [];
  let start = -1;
  let lines: string[] = [];
  const flush = () => {
    if (start >= 0) blocks.push({ from: start, text: lines.join("\n").replace(INLINE, blank) });
    start = -1;
    lines = [];
  };
  let fence: string | null = null;
  let html: RegExp | "blank" | null = null;
  // A paragraph that a setext line can turn into a heading. In a list, an indented line is prose.
  let plain = false;
  let inList = false;
  let pos = 0;
  for (const line of page.split("\n")) {
    const at = pos;
    pos += line.length + 1;
    if (html) {
      if (html === "blank" ? !line.trim() : html.test(line)) html = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      continue;
    }
    // A block that starts at the left edge ends a list.
    const edge = !/^\s/.test(line);
    if (f) {
      flush();
      fence = f[1];
      if (edge) inList = false;
      continue;
    }
    if (start >= 0 && plain && SETEXT.test(line)) {
      if (headings) flush();
      start = -1;
      lines = [];
      continue;
    }
    if (headings && /^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      flush();
      blocks.push({ from: at, text: line.replace(ATX, blank).replace(INLINE, blank) });
      if (edge) inList = false;
      continue;
    }
    html = htmlBlock(line, start >= 0);
    if (html) {
      flush();
      if (edge) inList = false;
      continue;
    }
    if (!line.trim() || NOT_PROSE.test(line)) {
      flush();
      if (line.trim() && edge) inList = false;
      continue;
    }
    // Indented code can't break into a paragraph, but it can start a block.
    if (start < 0 && !inList && INDENTED.test(line)) continue;
    const quote = QUOTE.exec(line)![0].length;
    const item = ITEM.exec(line.slice(quote));
    if (item) flush();
    const lead = quote + (item ? item[0].length : 0);
    const quoted = line.slice(0, quote).includes(">");
    if (start < 0) {
      start = at;
      plain = !item && !quoted;
      inList = Boolean(item) || (inList && INDENTED.test(line));
    } else if (quoted) plain = false;
    lines.push(" ".repeat(lead) + line.slice(lead));
  }
  flush();
  return blocks;
}
