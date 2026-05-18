"use client";

/** True when text is mostly Latin letters / numbers (expected for English STT). */
export function isLikelyEnglishTranscript(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  let nonLatin = 0;
  for (const ch of t) {
    if (/\s/.test(ch)) continue;
    if (/[\d.,'"!?@#$%&*()\-+/:;]/.test(ch)) continue;
    // Basic Latin + Latin-1 supplement + common extended Latin
    if (/[\u0000-\u024F\u1E00-\u1EFF]/.test(ch)) continue;
    nonLatin += 1;
  }

  return nonLatin / Math.max(t.length, 1) < 0.12;
}
