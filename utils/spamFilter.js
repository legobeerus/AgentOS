/**
 * Application spam detection.
 * Intentionally conservative: only blocks obvious repetitive spam or
 * applications where every long-form answer is a short/generic low-effort reply.
 */

const DEFAULTS = {
  globalShortAnswerMaxChars: 18,
  minAnswersForGlobalShortRule: 4,
  shortAnswerMaxChars: 16,
  repeatedCharRunThreshold: 10,
  repeatedPatternMinRepeats: 3,
  repeatedPatternMinLength: 18,
  maxUniqueWordsForAllShortSubmission: 12,
  minLongFormQuestionsForAllShortRule: 2,
  genericAnswerSet: [
    'letmein',
    'acceptme',
    'accept',
    'accept me',
    'let me in',
    'pick me',
    'hire me',
    'idk',
    'i dont know',
    'n/a',
    'na',
    'none',
    'test'
  ]
};

function mergeOptions(options) {
  const merged = {
    ...DEFAULTS,
    ...(options || {})
  };

  // Backward compatibility with previous config keys.
  if (options && options.minLongAnswerChars !== undefined && options.shortAnswerMaxChars === undefined) {
    merged.shortAnswerMaxChars = Number(options.minLongAnswerChars);
  }

  return merged;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortAllowedQuestion(question) {
  const key = normalizeText(question);
  if (!key) return false;
  return /(discord|roblox|username|user\s*id|userid|id\b|age\b|timezone|time zone|rank|department|division|group|link|url|proof|evidence|date|time|email|tag|handle)/i.test(key);
}

function normalizeCompact(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenizeWords(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9\s]/g, ' ');
  return normalized.split(/\s+/).filter(Boolean);
}

function isRepeatedWordOrChar(answer) {
  const s = String(answer || '').trim();
  if (!s) return false;

  const words = tokenizeWords(s);
  if (words.length >= 3) {
    const lower = words.map(w => w.toLowerCase());
    const uniq = new Set(lower);
    if (uniq.size === 1) return true;
    if (/^(\S+)(\s+\1)+$/i.test(s)) return true;
  }

  if (/^(.)\1{4,}$/.test(s)) return true;
  return false;
}

function hasRepeatedCharacterRun(answer, threshold) {
  const compact = normalizeCompact(answer);
  if (!compact) return false;
  const re = new RegExp(`(.)\\1{${Math.max(2, Number(threshold || 10)) - 1},}`);
  return re.test(compact);
}

function hasRepeatedPattern(answer, minRepeats, minLength) {
  const compact = normalizeCompact(answer);
  if (compact.length < Number(minLength || 18)) return false;
  const repeatsRequired = Math.max(2, Number(minRepeats || 3));
  const maxUnitLen = Math.floor(compact.length / repeatsRequired);

  for (let unitLen = 2; unitLen <= maxUnitLen; unitLen += 1) {
    if (compact.length % unitLen !== 0) continue;
    const unit = compact.slice(0, unitLen);
    const repeats = compact.length / unitLen;
    if (repeats < repeatsRequired) continue;
    if (unit.repeat(repeats) === compact) return true;
  }

  return false;
}

function isGenericLowEffort(answer, cfg) {
  const normalized = normalizeText(answer)
    .replace(/[^a-z0-9\s/]/g, '')
    .trim();
  if (!normalized) return true;

  const compact = normalizeCompact(answer);
  const phraseSet = new Set((cfg.genericAnswerSet || []).map(v => normalizeText(v)));
  if (phraseSet.has(normalized)) return true;

  const compactPhraseSet = new Set((cfg.genericAnswerSet || []).map(v => normalizeCompact(v)));
  if (compactPhraseSet.has(compact)) return true;

  return false;
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
      shortLongAnswerRatio: 0,
      obviousSpamAnswerCount: 0,
      genericShortLongAnswerCount: 0,
      uniqueWordCountInLongAnswers: 0
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

    const allAnswersVeryShort =
      nonEmpty.length >= Number(cfg.minAnswersForGlobalShortRule || 4) &&
      nonEmpty.every(e => e.answer.length < Number(cfg.globalShortAnswerMaxChars || 18));

    if (allAnswersVeryShort) {
      result.reasons.push('all_answers_too_short');
    }

    const longFormEntries = nonEmpty.filter(e => !isShortAllowedQuestion(e.question));
    result.metrics.longAnswerCount = longFormEntries.length;

    let shortLong = 0;
    let obviousSpamAnswerCount = 0;
    let genericShortLongAnswerCount = 0;
    const longFormWordSet = new Set();

    for (const entry of longFormEntries) {
      const ans = entry.answer;
      const words = tokenizeWords(ans);
      for (const w of words) longFormWordSet.add(w);

      if (ans.length <= cfg.shortAnswerMaxChars) shortLong += 1;

      const obviousSpam =
        hasRepeatedCharacterRun(ans, cfg.repeatedCharRunThreshold) ||
        hasRepeatedPattern(ans, cfg.repeatedPatternMinRepeats, cfg.repeatedPatternMinLength) ||
        isRepeatedWordOrChar(ans);

      if (obviousSpam) {
        obviousSpamAnswerCount += 1;
        result.reasons.push('obvious_repetition_spam');
      }

      const isVeryShort = ans.length <= cfg.shortAnswerMaxChars;
      if (isVeryShort && (isGenericLowEffort(ans, cfg) || isPlaceholderText(ans))) {
        genericShortLongAnswerCount += 1;
      }
    }

    result.metrics.shortLongAnswerCount = shortLong;
    result.metrics.shortLongAnswerRatio = longFormEntries.length ? (shortLong / longFormEntries.length) : 0;
    result.metrics.obviousSpamAnswerCount = obviousSpamAnswerCount;
    result.metrics.genericShortLongAnswerCount = genericShortLongAnswerCount;
    result.metrics.uniqueWordCountInLongAnswers = longFormWordSet.size;

    const allLongFormAreVeryShort =
      longFormEntries.length >= cfg.minLongFormQuestionsForAllShortRule &&
      shortLong === longFormEntries.length;

    const allLongFormAreGeneric =
      longFormEntries.length > 0 &&
      genericShortLongAnswerCount === longFormEntries.length;

    const lowSubmissionWordDiversity =
      longFormWordSet.size > 0 &&
      longFormWordSet.size <= cfg.maxUniqueWordsForAllShortSubmission;

    if (allLongFormAreVeryShort && allLongFormAreGeneric && lowSubmissionWordDiversity) {
      result.reasons.push('all_long_answers_short_and_generic');
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
