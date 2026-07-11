/**
 * Application spam detection with configurable heuristics.
 * Returns detailed analysis so callers can log why a submission was blocked.
 */

const DEFAULTS = {
  minTotalChars: 80,
  minLongAnswerChars: 12,
  minLongAnswerCount: 2,
  maxShortLongAnswerRatio: 0.6,
  duplicateLongAnswerThreshold: 3,
  trustTotalCharsBypass: 1200
};

function mergeOptions(options) {
  return {
    ...DEFAULTS,
    ...(options || {})
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForDuplicateCheck(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortAllowedQuestion(question) {
  const key = normalizeText(question);
  if (!key) return false;
  return /(discord|roblox|username|user\s*id|userid|id\b|age\b|timezone|time zone|rank|department|division|group|link|url|proof|evidence|date|time|email|tag|handle)/i.test(key);
}

function isRepeatedWordOrChar(answer) {
  const s = String(answer || '').trim();
  if (!s) return false;

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const lower = words.map(w => w.toLowerCase());
    const uniq = new Set(lower);
    if (uniq.size === 1) return true;
    if (/^(\S+)(\s+\1)+$/i.test(s)) return true;
  }

  if (/^(.)\1{4,}$/.test(s)) return true;
  return false;
}

function hasLowCharacterDiversity(answer) {
  const s = String(answer || '').replace(/\s+/g, '');
  if (s.length < 20) return false;
  const unique = new Set(s.toLowerCase().split('')).size;
  return unique / s.length <= 0.2;
}

function isPlaceholderText(answer) {
  const s = normalizeText(answer);
  if (!s) return true;
  return /^(n\/?a|na|none|idk|i don't know|unknown|test|asdf|qwerty|lorem ipsum|no)$/.test(s);
}

function analyzeSpamAnswers(answers, options) {
  const cfg = mergeOptions(options);
  const result = {
    isSpam: false,
    reasons: [],
    metrics: {
      totalAnswers: 0,
      totalChars: 0,
      totalCharsWithSpaces: 0,
      longAnswerCount: 0,
      shortLongAnswerCount: 0,
      shortLongAnswerRatio: 0
    }
  };

  try {
    const entries = Object.entries(answers || {}).map(([question, answer]) => ({
      question: String(question || ''),
      answer: String(answer || '').trim()
    }));

    const nonEmpty = entries.filter(e => e.answer.length > 0);
    result.metrics.totalAnswers = nonEmpty.length;

    if (!nonEmpty.length) {
      result.isSpam = true;
      result.reasons.push('empty_submission');
      return result;
    }

    const totalChars = nonEmpty.reduce((sum, e) => sum + e.answer.replace(/\s+/g, '').length, 0);
    const totalCharsWithSpaces = nonEmpty.reduce((sum, e) => sum + e.answer.length, 0);
    result.metrics.totalChars = totalChars;
    result.metrics.totalCharsWithSpaces = totalCharsWithSpaces;

    // Long submissions are unlikely to be low-effort spam; bypass stricter heuristics.
    if (totalCharsWithSpaces >= Number(cfg.trustTotalCharsBypass || 0)) {
      return result;
    }

    const longFormEntries = nonEmpty.filter(e => !isShortAllowedQuestion(e.question));
    result.metrics.longAnswerCount = longFormEntries.length;

    if (totalChars < cfg.minTotalChars) {
      result.reasons.push('total_chars_below_min');
    }

    if (longFormEntries.length >= cfg.minLongAnswerCount) {
      let shortLong = 0;
      const duplicateCounter = new Map();
      let placeholderCount = 0;

      for (const entry of longFormEntries) {
        const ans = entry.answer;
        const normalizedDup = normalizeForDuplicateCheck(ans);

        if (ans.length < cfg.minLongAnswerChars) shortLong += 1;
        if (isRepeatedWordOrChar(ans)) {
          result.reasons.push('repeated_word_or_char');
        }
        if (hasLowCharacterDiversity(ans)) {
          result.reasons.push('low_character_diversity');
        }
        if (isPlaceholderText(ans)) {
          placeholderCount += 1;
        }

        if (normalizedDup.length >= cfg.minLongAnswerChars) {
          duplicateCounter.set(normalizedDup, (duplicateCounter.get(normalizedDup) || 0) + 1);
        }
      }

      const ratio = shortLong / longFormEntries.length;
      result.metrics.shortLongAnswerCount = shortLong;
      result.metrics.shortLongAnswerRatio = Number.isFinite(ratio) ? ratio : 0;

      if (ratio >= cfg.maxShortLongAnswerRatio) {
        result.reasons.push('mostly_short_long_answers');
      }

      const maxDup = Math.max(0, ...Array.from(duplicateCounter.values()));
      if (maxDup >= cfg.duplicateLongAnswerThreshold) {
        result.reasons.push('duplicate_long_answers');
      }

      if (placeholderCount >= Math.ceil(longFormEntries.length * 0.5)) {
        result.reasons.push('mostly_placeholder_answers');
      }
    }

    const uniqueReasons = Array.from(new Set(result.reasons));
    result.reasons = uniqueReasons;
    result.isSpam = uniqueReasons.length > 0;
    return result;
  } catch (err) {
    return {
      ...result,
      isSpam: false,
      reasons: [],
      error: err ? String(err.message || err) : 'unknown_error'
    };
  }
}

function isSpamAnswers(answers, options) {
  return analyzeSpamAnswers(answers, options).isSpam;
}

module.exports = { isSpamAnswers, analyzeSpamAnswers };
