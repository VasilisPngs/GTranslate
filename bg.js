let activeController = null;

chrome.runtime.onMessage.addListener((req, sender, res) => {
  if (!req.t) return false;

  if (activeController) activeController.abort();
  activeController = new AbortController();
  const { signal } = activeController;

  const timeoutId = setTimeout(() => {
    if (activeController) activeController.abort();
  }, 8000);

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=el&dt=t&q=${encodeURIComponent(req.t)}`;

  fetch(url, { signal })
    .then(r => r.json())
    .then(data => {
      clearTimeout(timeoutId);
      if (data?.[2] === 'el') return res({ r: null });

      let out = '';
      if (data?.[0]) {
        for (let i = 0; i < data[0].length; i++) {
          out += data[0][i]?.[0] || '';
        }
      }
      res({ r: out });
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (err.name !== 'AbortError') res({ r: null });
    });

  return true;
});
