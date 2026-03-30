let ui = null;
let lastT = '';

document.addEventListener('mouseup', async () => {
  const active = document.activeElement;
  if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable) return;

  const s = window.getSelection();
  if (!s || s.rangeCount === 0 || s.isCollapsed) {
    lastT = '';
    return;
  }

  const t = s.toString().trim();
  if (!t || t === lastT) return;

  const r = s.getRangeAt(0).getBoundingClientRect();
  
  try {
    const res = await chrome.runtime.sendMessage({ t });
    
    const currentS = window.getSelection();
    if (currentS.isCollapsed || currentS.toString().trim() !== t) return;
    
    if (res?.r) {
      lastT = t;
      buildUI(res.r, r.left, r.bottom);
    }
  } catch {}
}, { passive: true });

document.addEventListener('mousedown', (e) => {
  if (ui && !ui.contains(e.target)) {
    ui.remove();
    ui = null;
  }
}, { passive: true });

function buildUI(txt, x, y) {
  if (ui) ui.remove();
  
  ui = document.createElement('div');
  ui.id = 'translate-ui';
  ui.textContent = txt;
  
  const px = Math.max(0, x + 300 > window.innerWidth ? window.innerWidth - 320 : x);
  const py = Math.max(0, y + 50 > window.innerHeight ? y - 60 : y + 8);
  
  ui.style.left = `${px}px`;
  ui.style.top = `${py}px`;
  
  document.body.appendChild(ui);
}