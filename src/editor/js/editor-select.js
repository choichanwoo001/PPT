// editor-select.js — Object selection, hover, tool mode UI

import { state, TOOL_MODE_DRAW, TOOL_MODE_SELECT, TOOL_MODE_NARRATION, SLIDE_W, SLIDE_H, NON_SELECTABLE_TAGS, DIRECT_TEXT_TAGS } from './editor-state.js';
import {
  slideIframe, slidePanel, drawBox, toolModeDrawBtn, toolModeSelectBtn, toolModeNarrationBtn,
  bboxToolbar, selectToolbar, narrationToolbar, editorHint, objectSelectedBox, objectHoverBox,
  selectedObjectMini, miniTag, miniText, selectEmptyHint,
  deleteSelectedObjectBtn,
  toggleBold, toggleItalic, toggleUnderline, toggleStrike,
  alignLeft, alignCenter, alignRight,
  popoverTextInput, popoverApplyText, popoverTextColorInput, popoverBgColorInput,
  popoverSizeInput, popoverApplySize,
} from './editor-dom.js';
import {
  currentSlideFile, getSlideState, setStatus, clamp,
  normalizeHexColor, parsePixelValue, isBoldFontWeight,
} from './editor-utils.js';
import { renderBboxes, scaleSlide, clientToSlidePoint, getXPath } from './editor-bbox.js';

function isElementNode(node) {
  return Boolean(node) && node.nodeType === Node.ELEMENT_NODE;
}

export function resolveXPath(doc, xpath) {
  if (!doc || typeof xpath !== 'string' || xpath.trim() === '') return null;
  try {
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch {
    return null;
  }
}

export function getSelectedObjectElement(slide = currentSlideFile()) {
  if (!slide) return null;
  const ss = getSlideState(slide);
  const xpath = ss.selectedObjectXPath;
  if (!xpath) return null;

  const doc = slideIframe.contentDocument;
  const el = resolveXPath(doc, xpath);
  return isElementNode(el) ? el : null;
}

export function isSelectableElement(el) {
  if (!isElementNode(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (NON_SELECTABLE_TAGS.has(tag)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

export function isTextEditableElement(el) {
  if (!isElementNode(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (!DIRECT_TEXT_TAGS.has(tag)) return false;
  const INLINE_TAGS = new Set(['BR','B','STRONG','I','EM','U','S','SPAN','A','SMALL','SUB','SUP','MARK','CODE']);
  return Array.from(el.children).every(c => INLINE_TAGS.has(c.tagName));
}

export function getSelectableTargetAt(clientX, clientY) {
  const doc = slideIframe.contentDocument;
  if (!doc) return null;

  const point = clientToSlidePoint(clientX, clientY);
  let node = doc.elementFromPoint(point.x, point.y);
  while (node && !isSelectableElement(node)) {
    node = node.parentElement;
  }
  return isElementNode(node) ? node : null;
}

export function elementToSlideRect(el) {
  if (!isElementNode(el)) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: clamp(Math.round(rect.left), 0, SLIDE_W),
    y: clamp(Math.round(rect.top), 0, SLIDE_H),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function applyOverlayRect(node, rect) {
  if (!node || !rect) {
    if (node) node.style.display = 'none';
    return;
  }

  node.style.display = 'block';
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

export function readSelectedObjectStyleState(el) {
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(el) : null;
  const textDecorationLine = styles?.textDecorationLine || '';
  return {
    textEditable: isTextEditableElement(el),
    textValue: (el.innerHTML || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
    textColor: normalizeHexColor(styles?.color, '#111111'),
    backgroundColor: normalizeHexColor(styles?.backgroundColor, '#ffffff'),
    fontSize: parsePixelValue(styles?.fontSize, 24),
    bold: isBoldFontWeight(styles?.fontWeight),
    italic: styles?.fontStyle === 'italic',
    underline: /\bunderline\b/.test(textDecorationLine),
    strike: /\bline-through\b/.test(textDecorationLine),
    textAlign: styles?.textAlign || 'left',
  };
}

function setToggleActive(button, active) {
  if (!button) return;
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function setControlEnabled(button, enabled) {
  if (!button) return;
  button.disabled = !enabled;
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

export function getSelectedObjectCapabilities(el) {
  const textEditable = isTextEditableElement(el);
  return {
    textEditable,
    textColorEditable: textEditable,
    backgroundEditable: isElementNode(el),
    sizeEditable: textEditable,
    emphasisEditable: textEditable,
    alignEditable: textEditable,
  };
}

function syncInlineInputs(snapshot) {
  if (!document.activeElement || !document.activeElement.closest?.('#select-toolbar')) {
    popoverTextInput.value = snapshot?.textValue || '';
    popoverSizeInput.value = String(snapshot?.fontSize || 24);
  }
  popoverTextColorInput.value = snapshot?.textColor || '#111111';
  popoverBgColorInput.value = snapshot?.backgroundColor || '#ffffff';
}

export function updateObjectEditorControls() {
  const selected = state.toolMode === TOOL_MODE_SELECT ? getSelectedObjectElement() : null;
  const snapshot = selected ? readSelectedObjectStyleState(selected) : null;
  const capabilities = getSelectedObjectCapabilities(selected);

  if (bboxToolbar) {
    bboxToolbar.hidden = state.toolMode !== TOOL_MODE_DRAW;
  }
  if (selectToolbar) {
    selectToolbar.hidden = state.toolMode !== TOOL_MODE_SELECT;
  }
  if (narrationToolbar) {
    narrationToolbar.hidden = state.toolMode !== TOOL_MODE_NARRATION;
  }

  if (selectedObjectMini && selectEmptyHint) {
    if (selected) {
      const tag = selected.tagName.toLowerCase();
      const fullText = (selected.textContent || '').trim();
      const preview = fullText.slice(0, 24);
      miniTag.textContent = `<${tag}>`;
      miniText.textContent = preview ? ` ${preview}${fullText.length > 24 ? '\u2026' : ''}` : '';
      selectedObjectMini.style.display = '';
      selectEmptyHint.style.display = 'none';
    } else {
      selectedObjectMini.style.display = 'none';
      selectEmptyHint.style.display = state.toolMode === TOOL_MODE_SELECT ? '' : 'none';
    }
  }

  popoverTextInput.disabled = !capabilities.textEditable;
  popoverApplyText.disabled = !capabilities.textEditable;
  popoverTextColorInput.disabled = !capabilities.textColorEditable;
  popoverBgColorInput.disabled = !capabilities.backgroundEditable;
  popoverSizeInput.disabled = !capabilities.sizeEditable;
  popoverApplySize.disabled = !capabilities.sizeEditable;
  if (deleteSelectedObjectBtn) deleteSelectedObjectBtn.disabled = !selected;

  setControlEnabled(toggleBold, capabilities.emphasisEditable);
  setControlEnabled(toggleItalic, capabilities.emphasisEditable);
  setControlEnabled(toggleUnderline, capabilities.emphasisEditable);
  setControlEnabled(toggleStrike, capabilities.emphasisEditable);
  setControlEnabled(alignLeft, capabilities.alignEditable);
  setControlEnabled(alignCenter, capabilities.alignEditable);
  setControlEnabled(alignRight, capabilities.alignEditable);

  setToggleActive(toggleBold, capabilities.emphasisEditable && snapshot?.bold);
  setToggleActive(toggleItalic, capabilities.emphasisEditable && snapshot?.italic);
  setToggleActive(toggleUnderline, capabilities.emphasisEditable && snapshot?.underline);
  setToggleActive(toggleStrike, capabilities.emphasisEditable && snapshot?.strike);
  setToggleActive(alignLeft, capabilities.alignEditable && (snapshot?.textAlign === 'left' || snapshot?.textAlign === 'start'));
  setToggleActive(alignCenter, capabilities.alignEditable && snapshot?.textAlign === 'center');
  setToggleActive(alignRight, capabilities.alignEditable && (snapshot?.textAlign === 'right' || snapshot?.textAlign === 'end'));

  syncInlineInputs(snapshot);
}

export function renderObjectSelection() {
  const selectedEl = state.toolMode === TOOL_MODE_SELECT ? getSelectedObjectElement() : null;
  const hoveredEl = state.toolMode === TOOL_MODE_SELECT
    ? resolveXPath(slideIframe.contentDocument, state.hoveredObjectXPath)
    : null;

  const selectedRect = selectedEl ? elementToSlideRect(selectedEl) : null;
  const hoveredRect = hoveredEl && hoveredEl !== selectedEl ? elementToSlideRect(hoveredEl) : null;
  applyOverlayRect(objectSelectedBox, selectedRect);
  applyOverlayRect(objectHoverBox, hoveredRect);
}

export function updateToolModeUI() {
  const isDraw = state.toolMode === TOOL_MODE_DRAW;
  const isSelect = state.toolMode === TOOL_MODE_SELECT;
  const isNarration = state.toolMode === TOOL_MODE_NARRATION;
  slidePanel.classList.toggle('mode-draw', isDraw);
  slidePanel.classList.toggle('mode-select', isSelect);
  toolModeDrawBtn.classList.toggle('active', isDraw);
  toolModeSelectBtn.classList.toggle('active', isSelect);
  if (toolModeNarrationBtn) toolModeNarrationBtn.classList.toggle('active', isNarration);
  toolModeDrawBtn.setAttribute('aria-pressed', isDraw ? 'true' : 'false');
  toolModeSelectBtn.setAttribute('aria-pressed', isSelect ? 'true' : 'false');
  if (toolModeNarrationBtn) toolModeNarrationBtn.setAttribute('aria-pressed', isNarration ? 'true' : 'false');
  editorHint.textContent = isDraw
    ? 'Drag on the slide to add red bboxes. Cmd/Ctrl+Enter to run.'
    : isSelect
      ? 'Click an object to edit. \u2318B bold \u00b7 \u2318I italic \u00b7 \u2318U underline'
      : 'Write slide narration, generate speech, then play it back.';
  renderBboxes();
  renderObjectSelection();
  updateObjectEditorControls();
  scaleSlide();
}

export function setToolMode(mode) {
  state.toolMode = mode === TOOL_MODE_SELECT
    ? TOOL_MODE_SELECT
    : mode === TOOL_MODE_NARRATION
      ? TOOL_MODE_NARRATION
      : TOOL_MODE_DRAW;
  state.drawing = false;
  state.drawStart = null;
  drawBox.style.display = 'none';
  if (state.toolMode !== TOOL_MODE_SELECT) {
    state.hoveredObjectXPath = '';
  }
  updateToolModeUI();
  setStatus(
    state.toolMode === TOOL_MODE_SELECT
      ? 'Select mode enabled.'
      : state.toolMode === TOOL_MODE_NARRATION
        ? 'Narration mode enabled.'
        : 'BBox draw mode enabled.',
  );
}

export function setSelectedObjectXPath(xpath, statusMessage = 'Object selected.') {
  const slide = currentSlideFile();
  if (!slide) return;
  const ss = getSlideState(slide);
  ss.selectedObjectXPath = xpath || '';
  state.hoveredObjectXPath = xpath || '';
  renderObjectSelection();
  updateObjectEditorControls();
  if (statusMessage) {
    setStatus(statusMessage);
  }
}

export function updateHoveredObjectFromPointer(clientX, clientY) {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  const target = getSelectableTargetAt(clientX, clientY);
  state.hoveredObjectXPath = target ? getXPath(target) : '';
  renderObjectSelection();
}

export function clearHoveredObject() {
  state.hoveredObjectXPath = '';
  renderObjectSelection();
}
