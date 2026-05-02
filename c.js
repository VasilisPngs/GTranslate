let ui = null;
let visible = false;
let lastT = '';
let reqId = 0;
let scTimer = null;

function ensureUI() {
  if (ui) return;
  ui = document.createElement('div');
  ui.id = 'translate-ui';
  document.body.appendChild(ui);
}

function getSel() {
  let el = document.activeElement;
  let doc = document;

  while (el && el.shadowRoot) {
    doc = el.shadowRoot;
    el = doc.activeElement;
  }

  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    try {
      if (el.selectionStart !== el.selectionEnd) {
        const t = el.value.substring(el.selectionStart, el.selectionEnd).trim();
        if (t) {
          const r = el.getBoundingClientRect();
          return { t, x: r.left + (r.width / 2) - 150, y: r.bottom };
        }
      }
    } catch {}
  }

  const s = doc.getSelection ? doc.getSelection() : window.getSelection();
  if (s && s.rangeCount > 0 && !s.isCollapsed) {
    const t = s.toString().trim();
    if (t) {
      const r = s.getRangeAt(0).getBoundingClientRect();
      return { t, x: r.left, y: r.bottom };
    }
  }
  return null;
}

function show(text, x, y) {
  ensureUI();
  const wasVisible = visible;
  ui.textContent = text;

  const safeX = 16;
  const maxW = 300;
  const px = Math.min(Math.max(safeX, x), window.innerWidth - maxW - safeX);
  const py = y + 50 > window.innerHeight ? Math.max(safeX, y - 60) : y + 8;

  ui.style.transition = wasVisible
    ? 'left 0.15s cubic-bezier(0.16,1,0.3,1), top 0.15s cubic-bezier(0.16,1,0.3,1)'
    : 'none';

  ui.style.left = `${px}px`;
  ui.style.top = `${py}px`;

  if (!wasVisible) {
    ui.classList.remove('visible');
    void ui.offsetWidth;
    ui.classList.add('visible');
  }
  visible = true;
}

function hide() {
  reqId++;
  lastT = '';
  if (ui) ui.classList.remove('visible');
  visible = false;
}

async function processText(t, x, y) {
  if (!t || t === lastT) return;
  if (!/[a-zA-ZΑ-Ωα-ωά-ώ]/.test(t)) return;

  const myId = ++reqId;
  try {
    const res = await chrome.runtime.sendMessage({ t });
    if (myId !== reqId) return;
    if (res?.r) {
      lastT = t;
      show(res.r, x, y);
    }
  } catch {}
}

function handleSelection() {
  const s = window.getSelection ? window.getSelection() : null;
  if (s && !s.isCollapsed && ui && ui.contains(s.anchorNode)) return;

  const data = getSel();
  if (!data) {
    if (visible) hide();
    return;
  }
  if (data.t === lastT) return;
  processText(data.t, data.x, data.y);
}

document.addEventListener('selectionchange', () => {
  clearTimeout(scTimer);
  scTimer = setTimeout(handleSelection, 200);
});

document.addEventListener('mousedown', (e) => {
  if (visible && ui && !ui.contains(e.target)) hide();
}, { capture: true, passive: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && visible) hide();
}, { capture: true });

document.addEventListener('scroll', () => {
  if (visible) hide();
}, { capture: true, passive: true });

window.addEventListener('resize', () => {
  if (visible) hide();
}, { passive: true });
