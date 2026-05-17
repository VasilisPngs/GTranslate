let activeController = null;

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || typeof req.t !== 'string' || !req.t) {
    sendResponse({ r: null });
    return false;
  }

  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;

  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=el&dt=t&q=${encodeURIComponent(req.t)}`;

  fetch(url, { signal: controller.signal })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      clearTimeout(timeoutId);

      if (!data || data?.[2] === 'el') {
        sendResponse({ r: null });
        return;
      }

      let out = '';
      const chunks = data[0];
      if (Array.isArray(chunks)) {
        for (const c of chunks) out += c?.[0] || '';
      }
      out = out.trim();
      sendResponse({ r: out || null });
    })
    .catch(() => {
      clearTimeout(timeoutId);
      sendResponse({ r: null });
    });

  return true;
});
