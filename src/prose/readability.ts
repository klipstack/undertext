// A page's readability: its grade, its hard sentences, and the marks words.ts and dashes.ts find
// in each paragraph. The rules are for English.
//
// The grade is the Automated Readability Index: 4.71 × letters/words + 0.5 × words/sentences −
// 21.43, rounded. A sentence of 14 or more words is hard at grade 10 and very hard at 14.

import { DashStyle, dashIssues, pageDashStyle } from "./dashes";
import { Issue, Report } from "./issues";
import { proseBlocks } from "./markdown";
import { sentences, WORD } from "./sentences";
import { wordIssues } from "./words";

const LETTER = /[\p{L}\p{N}]/gu;

const ari = (letters: number, words: number, sentences: number) =>
  Math.max(0, Math.round(4.71 * (letters / words) + (0.5 * words) / sentences - 21.43));

interface BlockResult {
  issues: Issue[];
  weakeners: number;
  words: number;
  letters: number;
  sentences: number;
}

function checkBlock(text: string, style: DashStyle): BlockResult {
  const result: BlockResult = { issues: [], weakeners: 0, words: 0, letters: 0, sentences: 0 };
  for (const s of sentences(text)) {
    const sentence = text.slice(s.from, s.to);
    const words = sentence.match(WORD)?.length ?? 0;
    const letters = sentence.match(LETTER)?.length ?? 0;
    result.words += words;
    result.letters += letters;
    result.sentences += 1;
    if (words < 14) continue;
    const grade = ari(letters, words, 1);
    if (grade >= 14) result.issues.push({ ...s, kind: "veryHard", note: `Very hard to read. ${words} words.` });
    else if (grade >= 10) result.issues.push({ ...s, kind: "hard", note: `Hard to read. ${words} words.` });
  }
  const marks = wordIssues(text);
  result.issues.push(...marks.issues, ...dashIssues(text, style));
  result.weakeners = marks.weakeners;
  return result;
}

/**
 * Checks a page each time it changes. Most edits change one paragraph, so it keeps each paragraph's
 * result from the last check and checks only the ones that changed. It keeps only those results, so
 * it never outgrows the page. Use one for each page.
 */
export function readabilityChecker(): (page: string) => Report {
  let seen = new Map<string, BlockResult>();
  return (page) => {
    const report: Report = { issues: [], weakeners: 0, words: 0, letters: 0, sentences: 0, grade: null };
    const kept = new Map<string, BlockResult>();
    // A block's dashes depend on the page's style, so its result is kept for that style.
    const style = pageDashStyle(page);
    for (const block of proseBlocks(page)) {
      const key = `${style}\n${block.text}`;
      const result = seen.get(key) ?? kept.get(key) ?? checkBlock(block.text, style);
      kept.set(key, result);
      for (const i of result.issues) report.issues.push({ ...i, from: i.from + block.from, to: i.to + block.from });
      report.weakeners += result.weakeners;
      report.words += result.words;
      report.letters += result.letters;
      report.sentences += result.sentences;
    }
    seen = kept;
    report.issues.sort((a, b) => a.from - b.from || b.to - a.to);
    if (report.words) report.grade = ari(report.letters, report.words, report.sentences);
    return report;
  };
}

/** The report on a page, checked from scratch. */
export const checkPage = (page: string): Report => readabilityChecker()(page);
