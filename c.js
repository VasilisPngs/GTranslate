(() => {
  "use strict";

  const POPUP_OFFSET = 8;
  const POPUP_MAX_WIDTH = 300;
  const POPUP_MAX_HEIGHT = 200;
  const MIN_SELECTION_LENGTH = 3;
  const MAX_SELECTION_LENGTH = 1000;
  const SKIPPED_SELECTION_SELECTOR = "code, pre, kbd, samp";
  const SCROLL_LISTENER_OPTIONS = { capture: true, passive: true };

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
  const DIGIT_PATTERN = /\d/;

  const POPUP_CSS = `
  :host {
    all: initial;
    position: fixed;
    z-index: 2147483646;
    color-scheme: light dark;
    font: message-box;
  }

  .panel {
    box-sizing: border-box;
    max-width: min(${POPUP_MAX_WIDTH}px, calc(100vw - ${POPUP_OFFSET * 2}px));
    max-height: min(${POPUP_MAX_HEIGHT}px, calc(100vh - ${POPUP_OFFSET * 2}px));
    overflow: auto;
    background: Canvas;
    color: CanvasText;
  }

  .result {
    margin: 0;
    padding: 0.5em 0.75em;
    font-size: 0.875em;
    overflow-wrap: anywhere;
  }

  .result::selection {
    color: HighlightText;
    background: Highlight;
  }
  `;

  let popupStyleSheet = null;
  let popupHost = null;
  let sessionActive = false;
  let sessionSourceText = "";
  let activeRequestId = 0;

  const collapseWhitespace = (value) => value.replace(/\s+/g, " ").trim();

  const getElementFromNode = (node) => {
    if (node instanceof Element) return node;
    if (node instanceof Text) return node.parentElement;

    return null;
  };

  const getEditableElement = () => {
    const element = document.activeElement;

    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  };

  const getSelectedText = () => {
    const editable = getEditableElement();

    if (!editable) return collapseWhitespace(window.getSelection()?.toString() ?? "");

    const { type, value, selectionStart, selectionEnd } = editable;

    if (type === "password" || typeof selectionStart !== "number" || typeof selectionEnd !== "number") return "";

    return collapseWhitespace(value.slice(selectionStart, selectionEnd));
  };

  const shouldSkipSelection = (value) => {
    if (value.length < MIN_SELECTION_LENGTH || value.length > MAX_SELECTION_LENGTH) return true;

    if (SKIPPED_TEXT_PATTERNS.some((pattern) => pattern.test(value))) return true;

    const compact = value.replaceAll(" ", "");

    return SKIPPED_COMPACT_TEXT_PATTERN.test(compact) && DIGIT_PATTERN.test(compact);
  };

  const isBlockedSelectionTarget = (target) => {
    if (getElementFromNode(target)?.closest(SKIPPED_SELECTION_SELECTOR)) return true;

    const selection = window.getSelection();

    if (!selection?.rangeCount) return false;

    return Boolean(getElementFromNode(selection.getRangeAt(0).commonAncestorContainer)?.closest(SKIPPED_SELECTION_SELECTOR));
  };

  const isSelectionInsidePopup = () => {
    if (!popupHost) return false;

    const node = window.getSelection()?.anchorNode;

    if (!node) return false;

    return popupHost.contains(node) || node.getRootNode() === popupHost.shadowRoot;
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

  const getSelectionAnchor = (event, target) => {
    if (getEditableElement()) return getPointerAnchor(event, target);

    const selection = window.getSelection();

    if (!selection?.rangeCount) return getPointerAnchor(event, target);

    const rect = selection.getRangeAt(0).getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) return getPointerAnchor(event, target);

    return {
      x: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom
    };
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

  const getPopupStyleSheet = () => {
    if (!popupStyleSheet) {
      popupStyleSheet = new CSSStyleSheet();
      popupStyleSheet.replaceSync(POPUP_CSS);
    }

    return popupStyleSheet;
  };

  const createPopup = (resultText) => {
    popupHost = document.createElement("div");

    const root = popupHost.attachShadow({ mode: "open" });
    const panel = document.createElement("div");
    const result = document.createElement("p");

    root.adoptedStyleSheets = [getPopupStyleSheet()];
    panel.className = "panel";
    result.className = "result";
    result.dir = "auto";
    result.textContent = resultText;

    panel.append(result);
    root.append(panel);
    document.body.append(popupHost);

    return panel;
  };

  const removePopup = () => {
    popupHost?.remove();
    popupHost = null;
  };

  const dismissPopup = () => {
    ++activeRequestId;
    removePopup();
    endSession();
  };

  const handleScroll = (event) => {
    if (event.target === popupHost) return;

    dismissPopup();
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;

    dismissPopup();
  };

  const startSession = (sourceText) => {
    sessionSourceText = sourceText;

    if (sessionActive) return;

    sessionActive = true;

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, SCROLL_LISTENER_OPTIONS);
    window.addEventListener("resize", dismissPopup);
    window.addEventListener("blur", dismissPopup);
  };

  const endSession = () => {
    if (!sessionActive) return;

    sessionActive = false;
    sessionSourceText = "";

    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("scroll", handleScroll, SCROLL_LISTENER_OPTIONS);
    window.removeEventListener("resize", dismissPopup);
    window.removeEventListener("blur", dismissPopup);
  };

  const translateText = async (text) => {
    try {
      const response = await chrome.runtime.sendMessage({ text });

      return response?.result || null;
    } catch {
      return null;
    }
  };

  const showPopup = async (sourceText, anchor, requestId) => {
    const resultText = await translateText(sourceText);

    if (requestId !== activeRequestId) return;

    if (!resultText || !document.body || getSelectedText() !== sourceText) {
      dismissPopup();
      return;
    }

    const panel = createPopup(resultText);
    const rect = panel.getBoundingClientRect();
    const placement = getPopupPlacement(rect.height, anchor);

    if (placement.availableHeight <= 0) {
      dismissPopup();
      return;
    }

    const height = Math.min(rect.height, placement.availableHeight);

    if (height < rect.height) panel.style.maxHeight = `${height}px`;

    popupHost.style.left = `${getPopupX(rect.width, anchor.x)}px`;
    popupHost.style.top = `${placement.below ? anchor.bottom + POPUP_OFFSET : anchor.top - POPUP_OFFSET - height}px`;
  };

  const handleMouseUp = async (event) => {
    if (event.button !== 0) return;

    const target = event.target;

    if (popupHost && target instanceof Node && popupHost.contains(target)) return;

    const previousText = sessionSourceText;

    dismissPopup();

    await scheduler.yield();

    const selectedText = getSelectedText();

    if (selectedText === previousText) return;

    if (shouldSkipSelection(selectedText) || isBlockedSelectionTarget(target)) return;

    const anchor = getSelectionAnchor(event, target);
    const requestId = ++activeRequestId;

    startSession(selectedText);
    showPopup(selectedText, anchor, requestId);
  };

  const handleSelectionChange = () => {
    if (!sessionActive) return;

    if (isSelectionInsidePopup()) return;

    if (getSelectedText() === sessionSourceText) return;

    dismissPopup();
  };

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("selectionchange", handleSelectionChange);
})();
