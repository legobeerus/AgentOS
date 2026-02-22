/**
 * Simple spam detection for form answers.
 * - Blocks answers that are the same word repeated multiple times (e.g. "yes yes yes")
 * - Blocks answers containing a single character repeated many times (e.g. "aaaaaa")
 * - Blocks submissions where most answers are extremely short (average <= 5 or >=60% <=5)
 */
function isRepeatedWord(answer) {
  const s = String(answer || '').trim();
  if (!s) return false;
  // multiple identical words (3+ repeats)
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const lower = words.map(w => w.toLowerCase());
    const uniq = new Set(lower);
    if (uniq.size === 1) return true;
    if (/^(\S+)(\s+\1)+$/i.test(s)) return true;
  }
  // single character repeated many times
  if (/^(.)\1{4,}$/.test(s)) return true;
  return false;
}

function isMostlyShort(answers) {
  const vals = Object.values(answers || {}).map(v => String(v || '').trim());
  if (!vals.length) return false;
  const shortCount = vals.filter(v => v.length <= 5).length;
  const ratio = shortCount / vals.length;
  const avg = vals.reduce((a, b) => a + b.length, 0) / vals.length;
  if (ratio >= 0.6) return true; // 60% or more answers are very short
  if (avg <= 5) return true; // average length very small
  return false;
}

function isSpamAnswers(answers) {
  try {
    // If any answer looks like a repeated word or repeated char, mark spam
    for (const v of Object.values(answers || {})) {
      if (isRepeatedWord(v)) return true;
    }
    // If the whole submission is mostly short answers, mark spam
    if (isMostlyShort(answers)) return true;
    return false;
  } catch (err) {
    // On error, default to non-spam to avoid false positives caused by unexpected data
    return false;
  }
}

module.exports = { isSpamAnswers };
