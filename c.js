const TARGET_LANG = 'el';
const IS_DISABLED_IN_CODE = true;
const IS_DISABLED_IN_TEXT_FIELDS = false;
const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 200;
const PANEL_FONT_SIZE = 14;
const PANEL_OFFSET = 0;

const waitTime = (time) => new Promise(resolve => setTimeout(resolve, time));

const getSelectedText = () => {
  const element = document.activeElement;
  const isInTextField = element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA');
  return isInTextField
    ? element.value.substring(element.selectionStart, element.selectionEnd)
    : (window.getSelection()?.toString() ?? '');
};

const getSelectedPosition = () => {
  const element = document.activeElement;
  const isInTextField = element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA');
  const selectedRect = isInTextField
    ? element.getBoundingClientRect()
    : window.getSelection().getRangeAt(0).getBoundingClientRect();
  return {
    x: selectedRect.left + selectedRect.width / 2,
    y: selectedRect.bottom
  };
};

const isInContentEditable = () => {
  const element = document.activeElement;
  if (!element) return false;
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true;
  if (element.contentEditable === 'true') return true;
  return false;
};

const removeTranslateContainer = () => {
  const element = document.getElementById('simple-translate');
  if (!element) return;
  if (element._dragCleanup) element._dragCleanup();
  element.parentNode.removeChild(element);
};

const translateText = (text) => {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ t: text }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response?.r || null);
      });
    } catch {
      resolve(null);
    }
  });
};

const calcPanelPosition = (panelWidth, panelHeight, refPos) => {
  const winW = document.documentElement.clientWidth;
  const winH = document.documentElement.clientHeight;
  const offset = PANEL_OFFSET;

  let x = refPos.x - panelWidth / 2;
  let y = refPos.y + offset;

  if (x + panelWidth > winW - offset) x = winW - panelWidth - offset;
  if (y + panelHeight > winH - offset) y = winH - panelHeight - offset;
  if (x < offset) x = offset;
  if (y < offset) y = offset;

  return { x, y };
};

const setupDrag = (container, panel, handle) => {
  let offsets = null;

  const onDragStart = (e) => {
    const rect = panel.getBoundingClientRect();
    offsets = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    try { e.dataTransfer.setData('text/plain', ''); } catch {}
  };

  const onDragOver = (e) => {
    if (!offsets) return;
    e.preventDefault();
    panel.style.top = `${e.clientY - offsets.y}px`;
    panel.style.left = `${e.clientX - offsets.x}px`;
  };

  const onDrop = (e) => {
    if (!offsets) return;
    e.preventDefault();
    panel.style.top = `${e.clientY - offsets.y}px`;
    panel.style.left = `${e.clientX - offsets.x}px`;
    offsets = null;
  };

  handle.draggable = true;
  handle.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);

  container._dragCleanup = () => {
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('drop', onDrop);
  };
};

const showTranslateContainer = async (selectedText, selectedPosition) => {
  if (document.getElementById('simple-translate')) return;

  const container = document.createElement('div');
  container.id = 'simple-translate';
  container.className = 'simple-translate-system-theme';
  document.body.appendChild(container);

  const resultText = await translateText(selectedText);

  if (!document.body.contains(container)) return;

  if (!resultText) {
    removeTranslateContainer();
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'simple-translate-panel';
  panel.style.fontSize = PANEL_FONT_SIZE + 'px';
  panel.style.width = PANEL_WIDTH + 'px';
  panel.style.height = PANEL_HEIGHT + 'px';

  const wrapper = document.createElement('div');
  wrapper.className = 'simple-translate-result-wrapper';

  const move = document.createElement('div');
  move.className = 'simple-translate-move';

  const contents = document.createElement('div');
  contents.className = 'simple-translate-result-contents';

  const resultP = document.createElement('p');
  resultP.className = 'simple-translate-result';
  resultP.dir = 'auto';
  resultP.textContent = resultText;

  contents.appendChild(resultP);
  wrapper.appendChild(move);
  wrapper.appendChild(contents);
  panel.appendChild(wrapper);
  container.appendChild(panel);

  const wrapperWidth = wrapper.clientWidth < PANEL_WIDTH ? wrapper.clientWidth + 1 : PANEL_WIDTH;
  const wrapperHeight = wrapper.clientHeight;
  const isOverflow = wrapperHeight === PANEL_HEIGHT;

  panel.style.width = wrapperWidth + 'px';
  panel.style.height = wrapperHeight + 'px';
  wrapper.style.overflow = isOverflow ? 'auto' : 'hidden';

  const pos = calcPanelPosition(wrapperWidth, wrapperHeight, selectedPosition);
  panel.style.left = pos.x + 'px';
  panel.style.top = pos.y + 'px';

  setupDrag(container, panel, move);

  panel.classList.add('isShow');
};

const handleMouseUp = async (e) => {
  await waitTime(10);

  const isLeftClick = e.button === 0;
  if (!isLeftClick) return;

  const isInPasswordField = e.target.tagName === 'INPUT' && e.target.type === 'password';
  if (isInPasswordField) return;

  const inCodeElement = e.target.tagName === 'CODE' || (!!e.target.closest && !!e.target.closest('code'));
  if (inCodeElement && IS_DISABLED_IN_CODE) return;

  const container = document.getElementById('simple-translate');
  const isInThisElement = container && container.contains(e.target);
  if (isInThisElement) return;

  removeTranslateContainer();

  const selectedText = getSelectedText();
  if (selectedText.length === 0) return;

  if (IS_DISABLED_IN_TEXT_FIELDS && isInContentEditable()) return;

  const selectedPosition = getSelectedPosition();
  showTranslateContainer(selectedText, selectedPosition);
};

const handleKeyDown = (e) => {
  if (e.key === 'Escape') removeTranslateContainer();
};

document.addEventListener('mouseup', handleMouseUp);
document.addEventListener('keydown', handleKeyDown);
