const POPUP_OFFSET = 8;
const MIN_SELECTION_LENGTH = 3;
const CONTAINER_ID = 'gtranslate-popup';
const SKIPPED_SELECTION_SELECTOR = 'code, pre, kbd, samp';

const SKIPPED_TEXT_PATTERNS = [
  /^https?:\/\//i,
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^[+-]?\d+(?:[.,]\d+)?$/,
  /^[+-]?\d+(?:[.,]\d+)?\s*%$/,
  /^(?:€|\$|£)\s*[+-]?\d+(?:[.,]\d+)?$/,
  /^[+-]?\d+(?:[.,]\d+)?\s*(?:€|\$|£)$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/,
  /^\d{1,2}:\d{2}(?::\d{2})?$/
];

const SKIPPED_COMPACT_TEXT_PATTERN = /^[A-Z0-9._:/#-]+$/;

let activeRequestId = 0;

const isPasswordInput = (element) => element instanceof HTMLInputElement && element.type === 'password';

const getElementFromNode = (node) => {
  if (node instanceof Element) return node;
  if (node instanceof Text) return node.parentElement;

  return null;
};

const isBlockedSelectionTarget = (target) => {
  const targetElement = getElementFromNode(target);

  if (targetElement?.closest(SKIPPED_SELECTION_SELECTOR)) return true;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return false;

  const container = getElementFromNode(selection.getRangeAt(0).commonAncestorContainer);

  return Boolean(container?.closest(SKIPPED_SELECTION_SELECTOR));
};

const shouldSkipSelection = (text) => {
  const value = String(text ?? '').trim();

  if (value.length < MIN_SELECTION_LENGTH) return true;

  const compact = value.replace(/\s+/g, '');

  if (SKIPPED_TEXT_PATTERNS.some((pattern) => pattern.test(value))) return true;

  return SKIPPED_COMPACT_TEXT_PATTERN.test(compact) && /\d/.test(compact);
};

const getSelectedText = () => {
  const element = document.activeElement;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (isPasswordInput(element)) return '';

    if (typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number') {
      return element.value.slice(element.selectionStart, element.selectionEnd);
    }

    return '';
  }

  return window.getSelection()?.toString() ?? '';
};

const getSelectionAnchor = (fallback) => {
  const element = document.activeElement;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return fallback;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return fallback;

  const rect = selection.getRangeAt(0).getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) return fallback;

  return {
    x: rect.left + rect.width / 2,
    top: rect.top,
    bottom: rect.bottom
  };
};

const removePopup = () => {
  document.getElementById(CONTAINER_ID)?.remove();
};

const translateText = async (text) => {
  try {
    const response = await chrome.runtime.sendMessage({ text });

    return response?.result || null;
  } catch {
    return null;
  }
};

const getPopupPlacement = (height, anchor) => {
  const viewportHeight = document.documentElement.clientHeight;
  const spaceBelow = Math.max(0, viewportHeight - anchor.bottom - POPUP_OFFSET * 2);
  const spaceAbove = Math.max(0, anchor.top - POPUP_OFFSET * 2);
  const below = height <= spaceBelow || (height > spaceAbove && spaceBelow >= spaceAbove);

  return {
    below,
    availableHeight: below ? spaceBelow : spaceAbove
  };
};

const getPopupX = (width, anchorX) => {
  const viewportWidth = document.documentElement.clientWidth;
  const maxX = Math.max(POPUP_OFFSET, viewportWidth - width - POPUP_OFFSET);

  return Math.min(Math.max(anchorX - width / 2, POPUP_OFFSET), maxX);
};

const getPointerAnchor = (event, target) => {
  const element = getElementFromNode(target);
  const style = element ? getComputedStyle(element) : null;
  const fontSize = Number.parseFloat(style?.fontSize) || 16;
  const lineHeight = Number.parseFloat(style?.lineHeight) || fontSize * 1.2;
  const halfLineHeight = lineHeight / 2;

  return {
    x: event.clientX,
    top: event.clientY - halfLineHeight,
    bottom: event.clientY + halfLineHeight
  };
};

const createPopup = (resultText) => {
  const container = document.createElement('div');
  container.id = CONTAINER_ID;

  const panel = document.createElement('div');
  panel.className = 'gtranslate-panel';

  const wrapper = document.createElement('div');
  wrapper.className = 'gtranslate-result-wrapper';

  const content = document.createElement('div');
  content.className = 'gtranslate-result-content';

  const result = document.createElement('p');
  result.className = 'gtranslate-result';
  result.dir = 'auto';
  result.textContent = resultText;

  content.appendChild(result);
  wrapper.appendChild(content);
  panel.appendChild(wrapper);
  container.appendChild(panel);
  document.body.appendChild(container);

  return panel;
};

const showPopup = async (sourceText, anchor, requestId) => {
  const resultText = await translateText(sourceText);

  if (
    requestId !== activeRequestId ||
    !resultText ||
    !document.body ||
    getSelectedText().trim() !== sourceText.trim()
  ) return;

  const panel = createPopup(resultText);
  const wrapper = panel.querySelector('.gtranslate-result-wrapper');
  let rect = panel.getBoundingClientRect();
  const placement = getPopupPlacement(rect.height, anchor);

  if (rect.height > placement.availableHeight && wrapper instanceof HTMLElement) {
    const wrapperHeight = wrapper.getBoundingClientRect().height;
    const panelChromeHeight = rect.height - wrapperHeight;

    wrapper.style.maxHeight = `${Math.max(0, placement.availableHeight - panelChromeHeight)}px`;
    rect = panel.getBoundingClientRect();
  }

  panel.style.left = `${getPopupX(rect.width, anchor.x)}px`;
  panel.style.top = `${placement.below ? anchor.bottom + POPUP_OFFSET : anchor.top - POPUP_OFFSET - rect.height}px`;
  panel.classList.add('is-show');
};

const handleMouseUp = (event) => {
  if (event.button !== 0) return;

  const target = event.target;
  const existing = document.getElementById(CONTAINER_ID);

  if (existing && target instanceof Node && existing.contains(target)) return;

  const requestId = ++activeRequestId;

  removePopup();

  if (isPasswordInput(target) || isPasswordInput(document.activeElement)) return;

  const selectedText = getSelectedText();

  if (shouldSkipSelection(selectedText) || isBlockedSelectionTarget(target)) return;

  const anchor = getSelectionAnchor(getPointerAnchor(event, target));

  showPopup(selectedText, anchor, requestId);
};

const handleSelectionChange = () => {
  if (getSelectedText().trim()) return;

  ++activeRequestId;
  removePopup();
};

const handleKeyDown = (event) => {
  if (event.key !== 'Escape') return;

  ++activeRequestId;
  removePopup();
};

document.addEventListener('mouseup', handleMouseUp);
document.addEventListener('selectionchange', handleSelectionChange, true);
document.addEventListener('keydown', handleKeyDown);
