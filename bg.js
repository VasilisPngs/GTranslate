const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const TARGET_LANG = "el";
const TIMEOUT_MS = 8000;
const CACHE_LIMIT = 100;
const SEPARATOR_SPLIT_PATTERN = /([-_/–—]+)/;
const LETTER_PATTERN = /\p{L}/u;

const activeControllers = new Map();
const translationCache = new Map();

const collapseWhitespace = (value) => value.replace(/\s+/g, " ").trim();

const normalizeText = (value) => collapseWhitespace(value).toLowerCase();

const getRequestKey = (sender) => `${sender.tab?.id}:${sender.frameId}`;

const isDistinct = (resultText, sourceText) => Boolean(resultText) && normalizeText(resultText) !== normalizeText(sourceText);

const readCache = (key) => {
  if (!translationCache.has(key)) return undefined;

  const value = translationCache.get(key);

  translationCache.delete(key);
  translationCache.set(key, value);

  return value;
};

const writeCache = (key, value) => {
  translationCache.delete(key);
  translationCache.set(key, value);

  if (translationCache.size > CACHE_LIMIT) {
    translationCache.delete(translationCache.keys().next().value);
  }
};

const fetchTranslation = async (sourceText, signal) => {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: TARGET_LANG,
    dt: "t",
    q: sourceText
  });

  const response = await fetch(`${TRANSLATE_URL}?${params}`, { signal });

  if (!response.ok) return { text: null, isTargetLang: false };

  let data;

  try {
    data = await response.json();
  } catch {
    return { text: null, isTargetLang: false };
  }

  const isTargetLang = data?.[2] === TARGET_LANG;

  if (isTargetLang || !Array.isArray(data?.[0])) {
    return { text: null, isTargetLang };
  }

  const text = data[0].map((chunk) => chunk?.[0] ?? "").join("").trim() || null;

  return { text, isTargetLang: false };
};

const restoreSeparators = (segments, translatedText) => {
  const terms = segments.filter((_, index) => index % 2 === 0);
  const translatedTerms = translatedText.split(/\s+/);

  if (translatedTerms.length !== terms.length) return null;

  let termIndex = 0;

  return segments
    .map((segment, index) => {
      if (index % 2 !== 0) return segment;

      const translatedTerm = translatedTerms[termIndex];
      termIndex += 1;
      return translatedTerm;
    })
    .join("");
};

const translateSeparated = async (sourceText, signal) => {
  if (!LETTER_PATTERN.test(sourceText)) return null;

  const segments = sourceText.split(SEPARATOR_SPLIT_PATTERN);

  if (segments.length < 3) return null;

  const terms = segments.filter((_, index) => index % 2 === 0).map(collapseWhitespace);

  if (terms.some((term) => !term || !LETTER_PATTERN.test(term))) return null;

  const spacedText = terms.join(" ");
  const translated = await fetchTranslation(spacedText, signal);

  if (translated.isTargetLang || !isDistinct(translated.text, spacedText)) return null;

  return restoreSeparators(segments, translated.text) ?? translated.text;
};

const translate = async (sourceText, signal) => {
  const direct = await fetchTranslation(sourceText, signal);

  if (direct.isTargetLang) return { result: null, isTargetLang: true };

  if (isDistinct(direct.text, sourceText)) return { result: direct.text, isTargetLang: false };

  const separated = await translateSeparated(sourceText, signal);

  return { result: separated, isTargetLang: false };
};

const respond = (sendResponse, payload) => {
  try {
    sendResponse(payload);
  } catch {
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const sourceText = typeof request?.text === "string" ? collapseWhitespace(request.text) : "";

  if (!sourceText) {
    sendResponse({ result: null });
    return false;
  }

  const cached = readCache(sourceText);

  if (cached !== undefined) {
    sendResponse({ result: cached });
    return false;
  }

  const requestKey = getRequestKey(sender);

  activeControllers.get(requestKey)?.abort();

  const controller = new AbortController();

  activeControllers.set(requestKey, controller);

  (async () => {
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      const outcome = await translate(sourceText, signal);

      if (outcome.result || outcome.isTargetLang) {
        writeCache(sourceText, outcome.result);
      }

      respond(sendResponse, { result: outcome.result });
    } catch {
      respond(sendResponse, { result: null });
    } finally {
      if (activeControllers.get(requestKey) === controller) {
        activeControllers.delete(requestKey);
      }
    }
  })();

  return true;
});