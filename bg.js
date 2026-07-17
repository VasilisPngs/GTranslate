const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const TARGET_LANG = 'el';
const TIMEOUT_MS = 8000;
const SEPARATOR_SPLIT_PATTERN = /([-_/–—]+)/;

const activeControllers = new Map();

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const getRequestKey = (sender) => `${sender.tab?.id ?? 'unknown'}:${sender.frameId ?? 0}`;

const isDistinct = (resultText, sourceText) => Boolean(resultText) && normalizeText(resultText) !== normalizeText(sourceText);

const fetchTranslation = async (sourceText, signal) => {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: TARGET_LANG,
    dt: 't',
    q: sourceText
  });

  const response = await fetch(`${TRANSLATE_URL}?${params}`, { signal });

  if (!response.ok) return null;

  const data = await response.json();

  if (!Array.isArray(data?.[0]) || data[2] === TARGET_LANG) return null;

  const resultText = data[0].map((chunk) => chunk?.[0] ?? '').join('').trim();

  return resultText || null;
};

const restoreSeparators = (segments, translatedText) => {
  const words = translatedText.split(' ');

  if (words.length !== (segments.length + 1) / 2) return translatedText;

  return segments.map((segment, index) => (index % 2 === 0 ? words[index / 2] : segment)).join('');
};

const translateSeparated = async (sourceText, signal) => {
  const segments = sourceText.split(SEPARATOR_SPLIT_PATTERN);

  if (segments.length < 3) return null;
  if (segments.some((segment, index) => index % 2 === 0 && !segment)) return null;

  const spacedText = segments.filter((_, index) => index % 2 === 0).join(' ');
  const translatedText = await fetchTranslation(spacedText, signal);

  if (!isDistinct(translatedText, spacedText)) return null;

  return restoreSeparators(segments, translatedText);
};

const translate = async (sourceText, signal) => {
  const directText = await fetchTranslation(sourceText, signal);

  if (isDistinct(directText, sourceText)) return directText;

  return translateSeparated(sourceText, signal);
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const sourceText = typeof request?.text === 'string' ? request.text.trim() : '';

  if (!sourceText) {
    sendResponse({ result: null });
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

      sendResponse({ result });
    } catch {
      sendResponse({ result: null });
    } finally {
      if (activeControllers.get(requestKey) === controller) {
        activeControllers.delete(requestKey);
      }
    }
  })();

  return true;
});
