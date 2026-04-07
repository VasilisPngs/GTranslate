let ui = null;
let lastT = '';

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

async function processText(t, x, y) {
  if (!t || t === lastT) return;
  if (!/[a-zA-ZΑ-Ωα-ωά-ώ]/.test(t)) return;

  try {
    const res = await chrome.runtime.sendMessage({ t });
    if (res?.r) {
      lastT = t;
      buildUI(res.r, x, y);
    }
  } catch {}
}

document.addEventListener('mouseup', (e) => {
  const data = getSel();
  if (data) {
    processText(data.t, data.x, data.y);
  } else {
    setTimeout(() => {
      const delayed = getSel();
      if (delayed) processText(delayed.t, delayed.x, delayed.y);
    }, 500);
  }
}, { capture: true, passive: true });

document.addEventListener('mousedown', (e) => {
  if (ui && !ui.contains(e.target)) {
    ui.remove();
    ui = null;
    lastT = '';
  }
}, { capture: true, passive: true });

function buildUI(txt, x, y) {
  if (ui) ui.remove();

  ui = document.createElement('div');
  ui.id = 'translate-ui';
  ui.textContent = txt;

  const safeX = 16;
  const maxW = 300;

  const px = Math.min(Math.max(safeX, x), window.innerWidth - maxW - safeX);
  const py = y + 50 > window.innerHeight ? Math.max(safeX, y - 60) : y + 8;

  ui.style.left = `${px}px`;
  ui.style.top = `${py}px`;

  document.body.appendChild(ui);
}