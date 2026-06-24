const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const TARGET_LANG = 'el';
const TIMEOUT_MS = 8000;

const activeControllers = new Map();

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const getRequestKey = (sender) => `${sender.tab?.id ?? 'unknown'}:${sender.frameId ?? 0}`;

const translate = async (sourceText, signal) => {
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

  if (!resultText || normalizeText(resultText) === normalizeText(sourceText)) return null;

  return resultText;
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
