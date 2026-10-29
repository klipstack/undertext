// "A" or "an": the sound a word starts with decides, not its first letter.

/** Whether `word` starts with a vowel sound, so takes "an": "an hour", but "a user". */
export function startsWithVowelSound(word: string): boolean {
  const w = word.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "");
  if (!w) return false;
  if (["hour", "honest", "honor", "honour", "heir"].some((p) => w.startsWith(p))) return true;
  if (["uni", "use", "usu", "uti", "eu", "one", "once", "ubiq", "uk"].some((p) => w.startsWith(p))) return false;
  if (/^(8|11|18)/.test(w)) return true;
  return /^[aeiou]/.test(w);
}
