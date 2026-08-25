"use strict";

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

  if (!response.ok) return null;

  let data;

  try {
    data = await response.json();
  } catch {
    return null;
  }

  if (!Array.isArray(data?.[0]) || data[2] === TARGET_LANG) return null;

  const resultText = data[0].map((chunk) => chunk?.[0] ?? "").join("").trim();

  return resultText || null;
};

const restoreSeparators = (segments, translatedText) => {
  const words = translatedText.split(/\s+/);

  if (words.length !== Math.ceil(segments.length / 2)) return translatedText;

  return segments.map((segment, index) => (index % 2 === 0 ? words[index / 2] : segment)).join("");
};

const translateSeparated = async (sourceText, signal) => {
  if (!LETTER_PATTERN.test(sourceText)) return null;

  const segments = sourceText.split(SEPARATOR_SPLIT_PATTERN);

  if (segments.length < 3) return null;

  const terms = segments.filter((_, index) => index % 2 === 0);

  if (terms.some((term) => !term || !LETTER_PATTERN.test(term))) return null;

  const spacedText = terms.join(" ");
  const translatedText = await fetchTranslation(spacedText, signal);

  if (!isDistinct(translatedText, spacedText)) return null;

  return restoreSeparators(segments, translatedText);
};

const translate = async (sourceText, signal) => {
  const directText = await fetchTranslation(sourceText, signal);

  if (isDistinct(directText, sourceText)) return directText;

  return translateSeparated(sourceText, signal);
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
      const result = await translate(sourceText, signal);

      writeCache(sourceText, result);
      respond(sendResponse, { result });
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
