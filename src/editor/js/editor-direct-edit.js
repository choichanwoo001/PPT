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

export async function persistDirectSlideHtml(slide, html, message) {
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

const HISTORY_LIMIT = 50;

function getSlideHistory(map, slide) {
  if (!map.has(slide)) {
    map.set(slide, { stack: [], lastCoalesceKey: '' });
  }
  return map.get(slide);
}

function pushHistoryEntry(history, html, coalesceKey = '') {
  if (!html) return;
  if (coalesceKey && history.lastCoalesceKey === coalesceKey) return;

  const last = history.stack[history.stack.length - 1];
  if (last?.html === html) return;

  history.stack.push({ html });
  if (history.stack.length > HISTORY_LIMIT) {
    history.stack.splice(0, history.stack.length - HISTORY_LIMIT);
  }
  history.lastCoalesceKey = coalesceKey || '';
}

export function recordUndoSnapshot({ coalesceKey = '' } = {}) {
  const slide = currentSlideFile();
  const html = serializeSlideDocument(slideIframe.contentDocument);
  if (!slide || !html) return;

  pushHistoryEntry(getSlideHistory(state.undoHistoryBySlide, slide), html, coalesceKey);
  getSlideHistory(state.redoHistoryBySlide, slide).stack = [];
}

function writeSlideDocument(html) {
  const doc = slideIframe.contentDocument;
  if (!doc || !html) return false;
  doc.open();
  doc.write(html);
  doc.close();
  return true;
}

async function restoreHistoryEntry(fromMap, toMap, message) {
  const slide = currentSlideFile();
  const currentHtml = serializeSlideDocument(slideIframe.contentDocument);
  if (!slide || !currentHtml) return false;

  const fromHistory = getSlideHistory(fromMap, slide);
  const entry = fromHistory.stack.pop();
  if (!entry?.html) {
    setStatus(message.includes('Redo') ? 'Nothing to redo.' : 'Nothing to undo.');
    return false;
  }

  const toHistory = getSlideHistory(toMap, slide);
  pushHistoryEntry(toHistory, currentHtml);
  fromHistory.lastCoalesceKey = '';
  toHistory.lastCoalesceKey = '';

  writeSlideDocument(entry.html);
  const ss = getSlideState(slide);
  ss.selectedObjectXPath = '';
  state.hoveredObjectXPath = '';
  renderObjectSelection();
  updateObjectEditorControls();
  await persistDirectSlideHtml(slide, entry.html, message);
  return true;
}

export function undoDirectEdit() {
  return restoreHistoryEntry(state.undoHistoryBySlide, state.redoHistoryBySlide, 'Undo applied and saved.');
}

export function redoDirectEdit() {
  return restoreHistoryEntry(state.redoHistoryBySlide, state.undoHistoryBySlide, 'Redo applied and saved.');
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

export function mutateSelectedObject(mutator, message, { delay = 0, preserveTextInput = false, historyCoalesceKey = '' } = {}) {
  const selected = getSelectedObjectElement();
  if (!selected) return;
  recordUndoSnapshot({ coalesceKey: historyCoalesceKey });
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
  recordUndoSnapshot();
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

export function copySelectedObject() {
  const selected = getSelectedObjectElement();
  if (!selected || selected === slideIframe.contentDocument?.body) {
    setStatus('No object selected to copy.');
    return false;
  }

  state.objectClipboard = {
    html: selected.outerHTML,
  };
  setStatus('Object copied.');
  return true;
}

function offsetPastedObject(el, offset = 12) {
  const styles = slideIframe.contentWindow?.getComputedStyle(el);
  const position = styles?.position || 'static';
  const isAbsolute = position === 'absolute' || position === 'fixed';

  if (isAbsolute) {
    el.style.left = `${Math.round(el.offsetLeft + offset)}px`;
    el.style.top = `${Math.round(el.offsetTop + offset)}px`;
    return;
  }

  const existingLeft = parsePx(el.style.left, 0);
  const existingTop = parsePx(el.style.top, 0);
  el.style.position = 'relative';
  el.style.left = `${Math.round(existingLeft + offset)}px`;
  el.style.top = `${Math.round(existingTop + offset)}px`;
}

export function pasteCopiedObject() {
  const clipboard = state.objectClipboard;
  if (!clipboard?.html) {
    setStatus('Nothing copied.');
    return false;
  }

  const doc = slideIframe.contentDocument;
  const selected = getSelectedObjectElement();
  const container = selected?.parentElement || doc?.querySelector('.slide') || doc?.body;
  if (!doc || !container) {
    setStatus('Could not paste object here.');
    return false;
  }

  const wrapper = doc.createElement('div');
  wrapper.innerHTML = clipboard.html.trim();
  const clone = wrapper.firstElementChild;
  if (!clone) {
    setStatus('Copied object is invalid.');
    return false;
  }

  recordUndoSnapshot();
  offsetPastedObject(clone);
  if (selected?.parentElement === container) {
    selected.insertAdjacentElement('afterend', clone);
  } else {
    container.appendChild(clone);
  }

  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    ss.selectedObjectXPath = getXPath(clone);
  }
  state.hoveredObjectXPath = getXPath(clone);
  renderObjectSelection();
  updateObjectEditorControls();
  scheduleDirectSave(0, 'Object pasted and saved.');
  setStatus('Object pasted.');
  return true;
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

function buildResizeSnapshot(el) {
  const styles = slideIframe.contentWindow?.getComputedStyle(el);
  const position = styles?.position || 'static';
  const isAbsolute = position === 'absolute' || position === 'fixed';
  const rect = el.getBoundingClientRect();

  return {
    baseLeft: isAbsolute ? el.offsetLeft : parsePx(el.style.left, 0),
    baseTop: isAbsolute ? el.offsetTop : parsePx(el.style.top, 0),
    baseWidth: rect.width || parsePx(styles?.width, el.offsetWidth || 1),
    baseHeight: rect.height || parsePx(styles?.height, el.offsetHeight || 1),
    makeRelative: position === 'static',
  };
}

function applyResize(el, snapshot, handle, dx, dy) {
  const affectsLeft = handle.includes('w');
  const affectsRight = handle.includes('e');
  const affectsTop = handle.includes('n');
  const affectsBottom = handle.includes('s');
  const minWidth = 8;
  const minHeight = 8;

  let nextLeft = snapshot.baseLeft;
  let nextTop = snapshot.baseTop;
  let nextWidth = snapshot.baseWidth;
  let nextHeight = snapshot.baseHeight;

  if (affectsRight) {
    nextWidth = snapshot.baseWidth + dx;
  }
  if (affectsBottom) {
    nextHeight = snapshot.baseHeight + dy;
  }
  if (affectsLeft) {
    nextWidth = snapshot.baseWidth - dx;
    nextLeft = snapshot.baseLeft + dx;
  }
  if (affectsTop) {
    nextHeight = snapshot.baseHeight - dy;
    nextTop = snapshot.baseTop + dy;
  }

  if (nextWidth < minWidth) {
    if (affectsLeft) nextLeft -= minWidth - nextWidth;
    nextWidth = minWidth;
  }
  if (nextHeight < minHeight) {
    if (affectsTop) nextTop -= minHeight - nextHeight;
    nextHeight = minHeight;
  }

  if ((affectsLeft || affectsTop) && snapshot.makeRelative && !el.style.position) {
    el.style.position = 'relative';
  }

  el.style.width = `${Math.round(nextWidth)}px`;
  el.style.height = `${Math.round(nextHeight)}px`;
  if (affectsLeft) el.style.left = `${Math.round(nextLeft)}px`;
  if (affectsTop) el.style.top = `${Math.round(nextTop)}px`;
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
    undoRecorded: false,
  };

  document.body.classList.add('object-dragging');
  event.preventDefault();
  return true;
}

export function startObjectResize(event) {
  if (state.toolMode !== TOOL_MODE_SELECT) return false;
  if (event.button !== 0) return false;

  const handle = event.target?.dataset?.resizeHandle;
  if (!handle) return false;

  const selected = getSelectedObjectElement();
  if (!selected) return false;

  state.objectResize = {
    el: selected,
    handle,
    startPoint: clientToSlidePoint(event.clientX, event.clientY),
    snapshot: buildResizeSnapshot(selected),
    didResize: false,
    undoRecorded: false,
  };

  document.body.classList.add('object-resizing');
  event.preventDefault();
  event.stopPropagation();
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
    if (!drag.undoRecorded) {
      recordUndoSnapshot();
      drag.undoRecorded = true;
    }
    drag.didMove = true;
  }

  applyDragOffset(drag.el, drag.snapshot, dx, dy);
  renderObjectSelection();
  event.preventDefault();
  return true;
}

export function moveObjectResize(event) {
  if (state.toolMode !== TOOL_MODE_SELECT || !state.objectResize) return false;

  const resize = state.objectResize;
  if (!isElementNode(resize.el)) {
    state.objectResize = null;
    document.body.classList.remove('object-resizing');
    return false;
  }

  const point = clientToSlidePoint(event.clientX, event.clientY);
  const dx = point.x - resize.startPoint.x;
  const dy = point.y - resize.startPoint.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    if (!resize.undoRecorded) {
      recordUndoSnapshot();
      resize.undoRecorded = true;
    }
    resize.didResize = true;
  }

  applyResize(resize.el, resize.snapshot, resize.handle, dx, dy);
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

export function endObjectResize() {
  if (!state.objectResize) return false;

  const didResize = state.objectResize.didResize;
  state.objectResize = null;
  document.body.classList.remove('object-resizing');

  if (didResize) {
    state.suppressNextSelectClick = true;
    renderObjectSelection();
    updateObjectEditorControls();
    scheduleDirectSave(80, 'Object resized and saved.');
    setStatus('Saving resized object...');
  }

  return didResize;
}
