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
  const FONT_FAMILY = "GTranslate Google Sans";
  const FONT_SIZE = "14px";
  const FONT_WEIGHT = "400 700";
  const FONT_FILES = [
    {
      file: "fonts/google-sans-greek.woff2",
      unicodeRange: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"
    },
    {
      file: "fonts/google-sans-latin-ext.woff2",
      unicodeRange: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"
    },
    {
      file: "fonts/google-sans-latin.woff2",
      unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
    }
  ];

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
    --md-sys-color-surface-container: light-dark(#f0edef, #19191b);
    --md-sys-color-on-surface-variant: light-dark(#5f5f61, #acaaad);
    --md-sys-shape-corner-medium: 12px;
    --md-sys-typescale-body-medium-font: "${FONT_FAMILY}", system-ui, sans-serif;
    --md-sys-typescale-body-medium-size: ${FONT_SIZE};
    --md-sys-typescale-body-medium-line-height: 20px;
    --md-sys-typescale-body-medium-tracking: 0.25px;
    --md-sys-typescale-body-medium-weight: 400;
    --md-sys-motion-spring-fast-spatial: 359ms linear(0, 0.053, 0.1817, 0.3473, 0.5207, 0.6822, 0.8197, 0.928, 1.0062, 1.057, 1.0847, 1.0945, 1.0916, 1.0806, 1.0654, 1.0489, 1.0333, 1.0197, 1.0088, 1.0008, 0.9954, 0.9924, 0.9911, 0.9912, 0.9921, 0.9935, 0.995, 0.9965, 0.9979, 1);
    --md-sys-motion-spring-fast-effects: 149ms linear(0, 0.1788, 0.4524, 0.6683, 0.8099, 0.8949, 0.9434, 0.97, 0.9844, 0.992, 0.9959, 0.9979, 1);

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

  @media (prefers-contrast: more) {
    .panel {
      --md-sys-color-on-surface-variant: light-dark(#434345, #bab8bb);
    }
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
  let fontFaces = null;
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
      if (root instanceof ShadowRoot) {
        const sel = root.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return sel;
      }
    }

    let active = document.activeElement;
    while (active?.shadowRoot) {
      const sel = active.shadowRoot.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return sel;
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

  const loadFont = (text) => {
    fontFaces ??= FONT_FILES.map(({ file, unicodeRange }) => new FontFace(FONT_FAMILY, `url("${browser.runtime.getURL(file)}")`, { weight: FONT_WEIGHT, unicodeRange }));

    for (const face of fontFaces) document.fonts.add(face);

    return document.fonts.load(`${FONT_SIZE} "${FONT_FAMILY}"`, text).catch(() => []);
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

    await loadFont(resultText);

    if (requestId !== activeRequestId) return;

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
