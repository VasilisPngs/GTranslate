let ui = null;
let lastT = '';

function getSelected() {
  let el = document.activeElement;
  let root = document;

  while (el && el.shadowRoot) {
    root = el.shadowRoot;
    el = root.activeElement;
  }

  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    try {
      if (el.selectionStart === el.selectionEnd) return '';
      return el.value.substring(el.selectionStart, el.selectionEnd).trim();
    } catch (e) {
      return '';
    }
  }

  const s = (root.getSelection ? root.getSelection() : window.getSelection());
  return s && s.rangeCount > 0 && !s.isCollapsed ? s.toString().trim() : '';
}

async function processText(t, x, y) {
  if (!t || t === lastT) return;
  lastT = t;
  
  try {
    const res = await chrome.runtime.sendMessage({ t });
    if (res?.r) {
      if (ui) ui.remove();
      
      ui = document.createElement('div');
      ui.id = 'translate-ui';
      ui.textContent = res.r;
      
      const safeX = 16;
      const maxW = 300;
      const px = Math.min(Math.max(safeX, x), window.innerWidth - maxW - safeX);
      const py = y + 50 > window.innerHeight ? Math.max(safeX, y - 60) : y + 20;
      
      ui.style.left = `${px}px`;
      ui.style.top = `${py}px`;
      
      document.body.appendChild(ui);
    } else {
      lastT = '';
    }
  } catch {
    lastT = '';
  }
}

document.addEventListener('mouseup', (e) => {
  let t = getSelected();
  if (t) {
    processText(t, e.clientX, e.clientY);
  } else {
    setTimeout(() => {
      t = getSelected();
      if (t) processText(t, e.clientX, e.clientY);
    }, 50);
  }
}, { capture: true, passive: true });

document.addEventListener('mousedown', (e) => {
  if (ui && !ui.contains(e.target)) {
    ui.remove();
    ui = null;
    lastT = '';
  }
}, { capture: true, passive: true });