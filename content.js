(() => {
  "use strict";

  const POPUP_OFFSET = 4;
  const POPUP_MAX_WIDTH = 320;
  const POPUP_MAX_HEIGHT = 360;
  const POPUP_EXIT_TIMEOUT_MS = 1000;
  const MIN_SELECTION_LENGTH = 2;
  const MAX_SELECTION_LENGTH = 1000;
  const SKIPPED_SELECTION_SELECTOR = "code, pre, kbd, samp";
  const SCROLL_LISTENER_OPTIONS = { capture: true };
  const CLOSING_ATTRIBUTE = "data-closing";

  const LETTER_PATTERN = /\p{L}/u;
  const NON_GREEK_LETTER_PATTERN = /[^\P{L}\p{Script=Greek}]/u;
  const SKIPPED_TEXT_PATTERNS = [
    /^https?:\/\//i,
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  ];

  const SKIPPED_COMPACT_TEXT_PATTERN = /^[A-Z0-9._:/#-]+$/i;
  const DIGIT_PATTERN = /\d/;

  const POPUP_CSS = `
  :host {
    all: initial !important;
    position: fixed !important;
    inset: auto !important;
    left: var(--popup-left) !important;
    top: var(--popup-top) !important;
    visibility: var(--popup-visibility, hidden) !important;
  }

  :host::backdrop {
    display: none !important;
  }

  .panel {
    --md-sys-color-surface-container: light-dark(#f3edf7, #211f26);
    --md-sys-color-on-surface-variant: light-dark(#49454f, #cac4d0);
    --md-sys-shape-corner-medium: 12px;
    --md-sys-typescale-body-medium-font: system-ui;
    --md-sys-typescale-body-medium-size: 14px;
    --md-sys-typescale-body-medium-line-height: 20px;
    --md-sys-typescale-body-medium-tracking: 0.25px;
    --md-sys-typescale-body-medium-weight: 400;
    --md-sys-motion-spring-fast-spatial: 224ms linear(0, 0.0143, 0.0514, 0.1041, 0.1666, 0.2345, 0.3046, 0.3743, 0.4418, 0.5059, 0.5659, 0.6211, 0.6715, 0.7169, 0.7576, 0.7936, 0.8254, 0.8532, 0.8773, 0.8981, 0.916, 0.9313, 0.9442, 0.9551, 0.9642, 0.9718, 0.9781, 0.9832, 0.9874, 0.9908, 0.9935, 0.9956, 0.9973, 0.9986, 0.9995, 1.0003, 1.0008, 1.0011, 1.0013, 1.0015, 1.0015, 1.0015, 1.0015, 1.0014, 1.0013, 1.0012, 1.0011, 1);
    --md-sys-motion-spring-fast-effects: 150ms linear(0, 0.017, 0.0598, 0.1187, 0.1865, 0.2582, 0.3303, 0.4003, 0.4666, 0.5284, 0.5851, 0.6366, 0.6829, 0.7243, 0.761, 0.7934, 0.8219, 0.8467, 0.8684, 0.8872, 0.9035, 0.9176, 0.9297, 0.9401, 0.9491, 0.9567, 0.9633, 0.9689, 0.9736, 0.9777, 0.9811, 0.9841, 0.9865, 0.9886, 0.9904, 0.9919, 0.9932, 0.9943, 0.9952, 0.996, 0.9966, 0.9972, 0.9976, 0.998, 0.9983, 0.9986, 0.9988, 1);

    color-scheme: light dark;
    box-sizing: border-box;
    max-width: min(${POPUP_MAX_WIDTH}px, calc(100dvw - ${POPUP_OFFSET * 2}px));
    max-height: min(${POPUP_MAX_HEIGHT}px, calc(100dvh - ${POPUP_OFFSET * 2}px));
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--md-sys-color-surface-container);
    color: var(--md-sys-color-on-surface-variant);
    border-radius: var(--md-sys-shape-corner-medium);
    box-shadow: 0 1px 2px rgb(0 0 0 / 30%), 0 2px 6px 2px rgb(0 0 0 / 15%);
    transition: scale var(--md-sys-motion-spring-fast-spatial), opacity var(--md-sys-motion-spring-fast-effects);
  }

  @starting-style {
    .panel {
      scale: 0.8;
      opacity: 0;
    }
  }

  :host([${CLOSING_ATTRIBUTE}]) .panel {
    scale: 0.8;
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      transition: none;
    }
  }

  .panel,
  .result {
    font-family: var(--md-sys-typescale-body-medium-font);
    font-weight: var(--md-sys-typescale-body-medium-weight);
    font-style: normal;
    letter-spacing: var(--md-sys-typescale-body-medium-tracking);
    text-transform: none;
  }

  .result {
    margin: 0;
    padding: 4px 16px;
    font-size: var(--md-sys-typescale-body-medium-size);
    line-height: var(--md-sys-typescale-body-medium-line-height);
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
  let sessionTarget = null;
  let activeRequestId = 0;

  const collapseWhitespace = (value) => value.replace(/\s+/g, " ").trim();

  const getElementFromNode = (node) => {
    if (node instanceof Element) return node;
    if (node instanceof Text) return node.parentElement;

    return null;
  };

  const getEditableElement = () => {
    let element = document.activeElement;

    while (element?.shadowRoot?.activeElement) {
      element = element.shadowRoot.activeElement;
    }

    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  };

  const getActiveSelection = (target) => {
    if (target instanceof Node) {
      const root = target.getRootNode();
      if (root instanceof ShadowRoot && typeof root.getSelection === "function") {
        const sel = root.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return sel;
      }
    }

    let active = document.activeElement;
    while (active?.shadowRoot) {
      if (typeof active.shadowRoot.getSelection === "function") {
        const sel = active.shadowRoot.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return sel;
      }
      active = active.shadowRoot.activeElement;
    }

    return window.getSelection();
  };

  const getSelectedText = (target) => {
    const editable = getEditableElement();

    if (!editable) return collapseWhitespace(getActiveSelection(target)?.toString() ?? "");

    const { type, value, selectionStart, selectionEnd } = editable;

    if (type === "password" || typeof selectionStart !== "number" || typeof selectionEnd !== "number") return "";

    return collapseWhitespace(value.slice(selectionStart, selectionEnd));
  };

  const shouldSkipSelection = (value) => {
    if (value.length < MIN_SELECTION_LENGTH || value.length > MAX_SELECTION_LENGTH) return true;

    if (!LETTER_PATTERN.test(value) || !NON_GREEK_LETTER_PATTERN.test(value)) return true;

    if (SKIPPED_TEXT_PATTERNS.some((pattern) => pattern.test(value))) return true;

    const compact = value.replaceAll(" ", "");

    return SKIPPED_COMPACT_TEXT_PATTERN.test(compact) && DIGIT_PATTERN.test(compact);
  };

  const isBlockedSelectionTarget = (target) => {
    if (getElementFromNode(target)?.closest(SKIPPED_SELECTION_SELECTOR)) return true;

    const selection = getActiveSelection(target);

    if (!selection?.rangeCount) return false;

    return Boolean(getElementFromNode(selection.getRangeAt(0).commonAncestorContainer)?.closest(SKIPPED_SELECTION_SELECTOR));
  };

  const isSelectionInsidePopup = () => {
    if (!popupHost) return false;

    const node = getActiveSelection(sessionTarget)?.anchorNode;

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

  const getRectsAnchor = (clientRects) => {
    if (!clientRects.length) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let validCount = 0;

    const baseLineHeight = clientRects[0].height || 20;
    const maxLineHeight = Math.max(48, baseLineHeight * 2.2);

    for (const r of clientRects) {
      if (r.width === 0 || r.height === 0) continue;

      if (r.height > maxLineHeight) break;

      if (validCount > 0 && r.top - bottom > maxLineHeight) break;

      if (r.left < minX) minX = r.left;
      if (r.right > maxX) maxX = r.right;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;

      validCount++;
    }

    if (!validCount) return null;

    return {
      x: minX + (maxX - minX) / 2,
      top,
      bottom
    };
  };

  const getEditableClientRects = (editable) => {
    const range = editable.createValueRange(editable.selectionStart, editable.selectionEnd);
    const clientRects = range.getClientRects();

    range.disconnect();

    return clientRects;
  };

  const getSelectionAnchor = (event, target) => {
    const editable = getEditableElement();

    if (editable) return getRectsAnchor(getEditableClientRects(editable)) ?? getPointerAnchor(event, target);

    const selection = getActiveSelection(target);

    if (!selection?.rangeCount) return getPointerAnchor(event, target);

    return getRectsAnchor(selection.getRangeAt(0).getClientRects()) ?? getPointerAnchor(event, target);
  };

  const getPopupPlacement = (height, anchor) => {
    const viewportHeight = window.visualViewport?.height ?? document.documentElement.clientHeight;
    const spaceBelow = Math.max(0, viewportHeight - anchor.bottom - POPUP_OFFSET * 2);
    const spaceAbove = Math.max(0, anchor.top - POPUP_OFFSET * 2);
    const below = height <= spaceBelow || (height > spaceAbove && spaceBelow >= spaceAbove);

    return {
      below,
      availableHeight: below ? spaceBelow : spaceAbove
    };
  };

  const getPopupX = (width, anchorX) => {
    const viewportWidth = window.visualViewport?.width ?? document.documentElement.clientWidth;
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
    popupHost.popover = "manual";

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
    document.documentElement.append(popupHost);
    popupHost.showPopover();

    return panel;
  };

  const closePopup = async (host) => {
    host.setAttribute(CLOSING_ATTRIBUTE, "");

    const animations = host.shadowRoot.getAnimations();

    if (animations.length) {
      await Promise.race([
        Promise.allSettled(animations.map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, POPUP_EXIT_TIMEOUT_MS))
      ]);
    }

    host.remove();
  };

  const removePopup = () => {
    if (!popupHost) return;

    closePopup(popupHost);
    popupHost = null;
  };

  const dismissPopup = () => {
    ++activeRequestId;
    removePopup();
    endSession();
  };

  const handleScroll = (event) => {
    if (!event.target.contains(sessionTarget)) return;

    dismissPopup();
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;

    dismissPopup();
  };

  const startSession = (sourceText, target) => {
    sessionSourceText = sourceText;
    sessionTarget = target;

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
    sessionTarget = null;

    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("scroll", handleScroll, SCROLL_LISTENER_OPTIONS);
    window.removeEventListener("resize", dismissPopup);
    window.removeEventListener("blur", dismissPopup);
  };

  const translateText = async (text) => {
    try {
      const response = await browser.runtime.sendMessage({ text });

      return response?.result ?? null;
    } catch {
      return null;
    }
  };

  const showPopup = async (sourceText, anchor, target, requestId) => {
    const resultText = await translateText(sourceText);

    if (requestId !== activeRequestId) return;

    if (!resultText || getSelectedText(target) !== sourceText) {
      dismissPopup();
      return;
    }

    const panel = createPopup(resultText);
    const rect = popupHost.getBoundingClientRect();
    const placement = getPopupPlacement(rect.height, anchor);

    if (placement.availableHeight <= 0) {
      dismissPopup();
      return;
    }

    const height = Math.min(rect.height, placement.availableHeight);

    if (height < rect.height) panel.style.maxHeight = `${height}px`;

    popupHost.style.setProperty("--popup-left", `${getPopupX(rect.width, anchor.x)}px`);
    popupHost.style.setProperty("--popup-top", `${placement.below ? anchor.bottom + POPUP_OFFSET : anchor.top - POPUP_OFFSET - height}px`);
    popupHost.style.setProperty("--popup-visibility", "visible");
  };

  const handleMouseUp = async (event) => {
    if (event.button !== 0) return;

    const target = event.target;

    if (popupHost && target instanceof Node && popupHost.contains(target)) return;

    const previousText = sessionSourceText;

    dismissPopup();

    await scheduler.yield();

    const selectedText = getSelectedText(target);

    if (selectedText === previousText) return;

    if (shouldSkipSelection(selectedText) || isBlockedSelectionTarget(target)) return;

    const anchor = getSelectionAnchor(event, target);
    const requestId = ++activeRequestId;

    startSession(selectedText, target);
    showPopup(selectedText, anchor, target, requestId);
  };

  const handleSelectionChange = () => {
    if (!sessionActive) return;

    if (isSelectionInsidePopup()) return;

    if (getSelectedText(sessionTarget) === sessionSourceText) return;

    dismissPopup();
  };

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("selectionchange", handleSelectionChange);
})();
