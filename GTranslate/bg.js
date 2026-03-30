chrome.runtime.onMessage.addListener((req, sender, res) => {
  if (!req.t) return false;
  
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=el&dt=t&q=${encodeURIComponent(req.t)}`;
  
  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (data?.[2] === 'el') return res({ r: null });
      
      let out = '';
      if (data?.[0]) {
        for (let i = 0; i < data[0].length; i++) {
          out += data[0][i]?.[0] || '';
        }
      }
      res({ r: out });
    })
    .catch(() => res({ r: null }));
    
  return true;
});