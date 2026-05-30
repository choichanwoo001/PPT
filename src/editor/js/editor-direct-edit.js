// editor-direct-edit.js — Style changes, direct save (debounced)

import { localFileUpdateBySlide, state, TOOL_MODE_SELECT } from './editor-state.js';
import { slideIframe } from './editor-dom.js';
import { currentSlideFile, getDirectSaveState, getSlideState, setStatus } from './editor-utils.js';
import { addChatMessage } from './editor-chat.js';
import {
  getSelectableTargetAt,
  getSelectedObjectElement,
  renderObjectSelection,
  setSelectedObjectXPath,
  updateObjectEditorControls,
  readSelectedObjectStyleState,
} from './editor-select.js';
import { clientToSlidePoint, getXPath } from './editor-bbox.js';

export function serializeSlideDocument(doc) {
  if (!doc?.documentElement) return '';
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}

async function persistDirectSlideHtml(slide, html, message) {
  if (!slide || !html) return;

  try {
    const res = await fetch(`/api/slides/${encodeURIComponent(slide)}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide, html }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Save failed with HTTP ${res.status}`);
    }

    localFileUpdateBySlide.set(slide, Date.now());
    if (slide === currentSlideFile()) {
      setStatus(message || `${slide} saved.`);
    }
  } catch (error) {
    addChatMessage('error', `[${slide}] Direct edit save failed: ${error.message}`, slide);
    setStatus(`Error: ${error.message}`);
  }
}

function queueDirectSave(slide, html, message) {
  const saveState = getDirectSaveState(slide);
  if (!html) return saveState.chain;
  saveState.chain = saveState.chain
    .catch(() => {})
    .then(() => persistDirectSlideHtml(slide, html, message));
  return saveState.chain;
}

export function scheduleDirectSave(delay = 0, message = 'Object updated and saved.') {
  const slide = currentSlideFile();
  const html = serializeSlideDocument(slideIframe.contentDocument);
  if (!slide || !html) return;

  const saveState = getDirectSaveState(slide);
  saveState.pendingHtml = html;
  saveState.pendingMessage = message;
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
  }
  saveState.timer = window.setTimeout(() => {
    saveState.timer = null;
    const nextHtml = saveState.pendingHtml;
    const nextMessage = saveState.pendingMessage;
    saveState.pendingHtml = '';
    queueDirectSave(slide, nextHtml, nextMessage);
  }, Math.max(0, delay));
}

export async function flushDirectSaveForSlide(slide) {
  if (!slide) return;

  const saveState = getDirectSaveState(slide);
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
    saveState.timer = null;
    const html = saveState.pendingHtml;
    const message = saveState.pendingMessage;
    saveState.pendingHtml = '';
    await queueDirectSave(slide, html, message);
    return;
  }

  await saveState.chain.catch(() => {});
}

export function applyTextDecorationToken(el, token, shouldEnable) {
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(el) : null;
  const parts = new Set(
    String(styles?.textDecorationLine || '')
      .split(/\s+/)
      .filter((part) => part === 'underline' || part === 'line-through'),
  );
  if (shouldEnable) {
    parts.add(token);
  } else {
    parts.delete(token);
  }
  el.style.textDecorationLine = parts.size > 0 ? Array.from(parts).join(' ') : 'none';
}

export function mutateSelectedObject(mutator, message, { delay = 0, preserveTextInput = false } = {}) {
  const selected = getSelectedObjectElement();
  if (!selected) return;
  mutator(selected);
  renderObjectSelection();
  updateObjectEditorControls({ preserveTextInput });
  scheduleDirectSave(delay, message);
  setStatus('Saving direct edit...');
}

export function deleteSelectedObject() {
  const selected = getSelectedObjectElement();
  if (!selected || selected === slideIframe.contentDocument?.body) return;

  const slide = currentSlideFile();
  selected.remove();

  if (slide) {
    const ss = getSlideState(slide);
    ss.selectedObjectXPath = '';
  }

  state.hoveredObjectXPath = '';
  renderObjectSelection();
  updateObjectEditorControls();
  scheduleDirectSave(0, 'Object deleted and saved.');
  setStatus('Saving deleted object...');
}

function parsePx(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isElementNode(node) {
  return Boolean(node) && node.nodeType === Node.ELEMENT_NODE;
}

function findMovableElement(el) {
  if (!isElementNode(el)) return null;

  let node = el;
  while (isElementNode(node) && node !== slideIframe.contentDocument?.body) {
    const styles = slideIframe.contentWindow?.getComputedStyle(node);
    const position = styles?.position || 'static';
    if (position === 'absolute' || position === 'fixed') {
      return node;
    }
    node = node.parentElement;
  }

  return el;
}

function buildDragSnapshot(el) {
  const styles = slideIframe.contentWindow?.getComputedStyle(el);
  const position = styles?.position || 'static';
  const isAbsolute = position === 'absolute' || position === 'fixed';

  return {
    baseLeft: isAbsolute ? el.offsetLeft : parsePx(el.style.left, 0),
    baseTop: isAbsolute ? el.offsetTop : parsePx(el.style.top, 0),
    makeRelative: position === 'static',
  };
}

function applyDragOffset(el, snapshot, dx, dy) {
  if (snapshot.makeRelative && !el.style.position) {
    el.style.position = 'relative';
  }
  el.style.left = `${Math.round(snapshot.baseLeft + dx)}px`;
  el.style.top = `${Math.round(snapshot.baseTop + dy)}px`;
}

export function startObjectDrag(event) {
  if (state.toolMode !== TOOL_MODE_SELECT) return false;
  if (event.button !== 0) return false;

  const target = getSelectableTargetAt(event.clientX, event.clientY);
  if (!target) return false;

  const selectedXPath = getXPath(target);
  setSelectedObjectXPath(selectedXPath, `Object selected on ${currentSlideFile()}.`);

  const movable = findMovableElement(target);
  if (!movable) return false;

  state.objectDrag = {
    el: movable,
    startPoint: clientToSlidePoint(event.clientX, event.clientY),
    snapshot: buildDragSnapshot(movable),
    didMove: false,
  };

  document.body.classList.add('object-dragging');
  event.preventDefault();
  return true;
}

export function moveObjectDrag(event) {
  if (state.toolMode !== TOOL_MODE_SELECT || !state.objectDrag) return false;

  const drag = state.objectDrag;
  if (!isElementNode(drag.el)) {
    state.objectDrag = null;
    document.body.classList.remove('object-dragging');
    return false;
  }

  const point = clientToSlidePoint(event.clientX, event.clientY);
  const dx = point.x - drag.startPoint.x;
  const dy = point.y - drag.startPoint.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    drag.didMove = true;
  }

  applyDragOffset(drag.el, drag.snapshot, dx, dy);
  renderObjectSelection();
  event.preventDefault();
  return true;
}

export function endObjectDrag() {
  if (!state.objectDrag) return false;

  const didMove = state.objectDrag.didMove;
  state.objectDrag = null;
  document.body.classList.remove('object-dragging');

  if (didMove) {
    state.suppressNextSelectClick = true;
    renderObjectSelection();
    updateObjectEditorControls();
    scheduleDirectSave(80, 'Object moved and saved.');
    setStatus('Saving moved object...');
  }

  return didMove;
}
