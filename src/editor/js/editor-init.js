// editor-init.js — Entry point: imports, event bindings, init()

import { state, TOOL_MODE_DRAW, TOOL_MODE_SELECT, TOOL_MODE_NARRATION, setSlideFrame } from './editor-state.js';
import {
  btnPrev, btnNext, slideIframe, slideWrapper, drawLayer, promptInput, modelSelect,
  btnSend, btnClearBboxes, slideCounter,
  toggleBold, toggleItalic, toggleUnderline, toggleStrike,
  alignLeft, alignCenter, alignRight,
  popoverTextInput, popoverApplyText, popoverTextColorInput, popoverBgColorInput,
  popoverSizeInput, popoverApplySize, toolModeDrawBtn, toolModeSelectBtn,
  toolModeNarrationBtn, deleteSelectedObjectBtn, objectSelectedBox,
} from './editor-dom.js';
import {
  currentSlideFile, getSlideState, normalizeModelName, setStatus,
  saveSelectedModel, loadModelOptions, clamp,
} from './editor-utils.js';
import { renderChatMessages } from './editor-chat.js';
import {
  onBboxChange, renderBboxes, scaleSlide, startDrawing, moveDrawing, endDrawing,
  clearBboxesForCurrentSlide, initBboxLayerEvents, getXPath,
} from './editor-bbox.js';
import {
  setToolMode, updateToolModeUI, renderObjectSelection, updateObjectEditorControls,
  getSelectedObjectElement, setSelectedObjectXPath, updateHoveredObjectFromPointer,
  clearHoveredObject, getSelectableTargetAt, readSelectedObjectStyleState,
} from './editor-select.js';
import {
  mutateSelectedObject, applyTextDecorationToken,
  startObjectDrag, moveObjectDrag, endObjectDrag, deleteSelectedObject,
  startObjectResize, moveObjectResize, endObjectResize,
  undoDirectEdit, redoDirectEdit, copySelectedObject, pasteCopiedObject,
} from './editor-direct-edit.js';
import { updateSendState, applyChanges } from './editor-send.js';
import { goToSlide } from './editor-navigation.js';
import { connectSSE, loadRunsInitial } from './editor-sse.js';
import { bindNarrationEvents, loadNarration } from './editor-narration.js';

// Late-binding: connect bbox changes to updateSendState
onBboxChange(updateSendState);

// Bbox layer events
initBboxLayerEvents();

// Navigation
btnPrev.addEventListener('click', () => { void goToSlide(state.currentIndex - 1); });
btnNext.addEventListener('click', () => { void goToSlide(state.currentIndex + 1); });

// Tool modes
toolModeDrawBtn.addEventListener('click', () => setToolMode(TOOL_MODE_DRAW));
toolModeSelectBtn.addEventListener('click', () => setToolMode(TOOL_MODE_SELECT));
toolModeNarrationBtn?.addEventListener('click', () => setToolMode(TOOL_MODE_NARRATION));

// Clear bboxes
btnClearBboxes.addEventListener('click', clearBboxesForCurrentSlide);

// Drawing
drawLayer.addEventListener('mousedown', startDrawing);
drawLayer.addEventListener('mousedown', startObjectDrag);
objectSelectedBox.addEventListener('mousedown', startObjectResize);
drawLayer.addEventListener('mousemove', (event) => {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  if (state.objectDrag || state.objectResize) return;
  updateHoveredObjectFromPointer(event.clientX, event.clientY);
});
drawLayer.addEventListener('mouseleave', clearHoveredObject);
drawLayer.addEventListener('click', (event) => {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  if (state.suppressNextSelectClick) {
    state.suppressNextSelectClick = false;
    return;
  }
  const target = getSelectableTargetAt(event.clientX, event.clientY);
  if (!target) {
    setSelectedObjectXPath('', 'No selectable object at this point.');
    return;
  }

  const xpath = getXPath(target);
  setSelectedObjectXPath(xpath, `Object selected on ${currentSlideFile()}.`);
});
window.addEventListener('mousemove', (event) => {
  moveDrawing(event);
  moveObjectResize(event);
  moveObjectDrag(event);
});
window.addEventListener('mouseup', (event) => {
  endDrawing(event);
  endObjectResize();
  endObjectDrag();
});

// Send
btnSend.addEventListener('click', applyChanges);
bindNarrationEvents();

// Model select
modelSelect.addEventListener('change', () => {
  const nextModel = normalizeModelName(modelSelect.value);
  if (!state.availableModels.includes(nextModel)) {
    modelSelect.value = state.selectedModel;
    return;
  }

  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    ss.model = nextModel;
  }
  state.selectedModel = nextModel;
  state.defaultModel = nextModel;
  saveSelectedModel(state.selectedModel);
  updateSendState();
  setStatus(`Model selected: ${state.selectedModel}`);
});

// Prompt input
promptInput.addEventListener('input', () => {
  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    ss.prompt = promptInput.value;
  }
  updateSendState();
});

function applySelectedTextFromInput(message = 'Object text updated and saved.', delay = 120) {
  const selected = getSelectedObjectElement();
  const xpath = selected ? getXPath(selected) : '';
  mutateSelectedObject((el) => {
    const escaped = popoverTextInput.value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    el.innerHTML = escaped.replace(/\n/g, '<br>');
  }, message, { delay, preserveTextInput: true, historyCoalesceKey: `text:${xpath}` });
}

function applySelectedSizeFromInput(message = 'Object font size updated and saved.', delay = 0) {
  const size = clamp(Number.parseInt(popoverSizeInput.value || '24', 10) || 24, 8, 180);
  const selected = getSelectedObjectElement();
  const xpath = selected ? getXPath(selected) : '';
  mutateSelectedObject((el) => {
    el.style.fontSize = `${size}px`;
  }, message, { delay, preserveTextInput: true, historyCoalesceKey: `size:${xpath}` });
}

// Text editing
popoverTextInput.addEventListener('input', () => {
  if (popoverTextInput.disabled) return;
  applySelectedTextFromInput('Object text updated and saved.', 300);
});

popoverApplyText.addEventListener('click', () => {
  if (popoverApplyText.disabled) return;
  applySelectedTextFromInput('Object text updated and saved.', 0);
});

popoverSizeInput.addEventListener('input', () => {
  if (popoverSizeInput.disabled) return;
  applySelectedSizeFromInput('Object font size updated and saved.', 300);
});

popoverApplySize.addEventListener('click', () => {
  if (popoverApplySize.disabled) return;
  applySelectedSizeFromInput('Object font size updated and saved.', 0);
});

popoverTextInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    popoverApplyText.click();
  }
});

popoverSizeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    popoverApplySize.click();
  }
});

popoverTextColorInput.addEventListener('input', () => {
  if (popoverTextColorInput.disabled) return;
  const selected = getSelectedObjectElement();
  const xpath = selected ? getXPath(selected) : '';
  mutateSelectedObject((el) => {
    el.style.color = popoverTextColorInput.value;
  }, 'Text color updated.', { delay: 300, historyCoalesceKey: `text-color:${xpath}` });
});

popoverBgColorInput.addEventListener('input', () => {
  if (popoverBgColorInput.disabled) return;
  const selected = getSelectedObjectElement();
  const xpath = selected ? getXPath(selected) : '';
  mutateSelectedObject((el) => {
    el.style.backgroundColor = popoverBgColorInput.value;
  }, 'Background color updated.', { delay: 300, historyCoalesceKey: `bg-color:${xpath}` });
});

function hasEditableFocus() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (activeElement.matches('input, textarea, select')) return true;
  return activeElement.isContentEditable;
}

// Style toggles
toggleBold.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextBold = !readSelectedObjectStyleState(el).bold;
    el.style.fontWeight = nextBold ? '700' : '400';
  }, 'Object font weight updated and saved.');
});

toggleItalic.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextItalic = !readSelectedObjectStyleState(el).italic;
    el.style.fontStyle = nextItalic ? 'italic' : 'normal';
  }, 'Object font style updated and saved.');
});

toggleUnderline.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextUnderline = !readSelectedObjectStyleState(el).underline;
    applyTextDecorationToken(el, 'underline', nextUnderline);
  }, 'Object underline updated and saved.');
});

toggleStrike.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextStrike = !readSelectedObjectStyleState(el).strike;
    applyTextDecorationToken(el, 'line-through', nextStrike);
  }, 'Object strikethrough updated and saved.');
});

// Alignment
alignLeft.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'left';
  }, 'Object alignment updated and saved.');
});

alignCenter.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'center';
  }, 'Object alignment updated and saved.');
});

alignRight.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'right';
  }, 'Object alignment updated and saved.');
});

deleteSelectedObjectBtn.addEventListener('click', () => {
  if (deleteSelectedObjectBtn.disabled) return;
  deleteSelectedObject();
});

// Global keyboard
document.addEventListener('keydown', (event) => {
  const inEditableField = hasEditableFocus();

  if (state.toolMode === TOOL_MODE_SELECT && (event.ctrlKey || event.metaKey) && !inEditableField) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undoDirectEdit();
      return;
    }
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      void redoDirectEdit();
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      void redoDirectEdit();
      return;
    }
    if (key === 'c') {
      event.preventDefault();
      copySelectedObject();
      return;
    }
    if (key === 'v') {
      event.preventDefault();
      pasteCopiedObject();
      return;
    }
    if (key === 'b') { event.preventDefault(); if (!toggleBold.disabled) toggleBold.click(); return; }
    if (key === 'i') { event.preventDefault(); if (!toggleItalic.disabled) toggleItalic.click(); return; }
    if (key === 'u') { event.preventDefault(); if (!toggleUnderline.disabled) toggleUnderline.click(); return; }
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    applyChanges();
    return;
  }

  if (state.toolMode === TOOL_MODE_SELECT && !inEditableField && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    deleteSelectedObject();
    return;
  }

  if (event.key === 'Escape') {
    if (document.activeElement) document.activeElement.blur();
    return;
  }

  if (inEditableField) return;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    void goToSlide(state.currentIndex - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    void goToSlide(state.currentIndex + 1);
  }
});

// Resize
window.addEventListener('resize', scaleSlide);

// Iframe load
slideIframe.addEventListener('load', () => {
  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    if (ss.selectedObjectXPath && !getSelectedObjectElement(slide)) {
      ss.selectedObjectXPath = '';
    }
  }
  state.hoveredObjectXPath = '';
  renderBboxes();
  renderObjectSelection();
  updateObjectEditorControls();
  updateSendState();
});

function applySlideFrameCss(width, height) {
  if (slideWrapper) {
    slideWrapper.style.width = `${width}px`;
    slideWrapper.style.height = `${height}px`;
  }
  if (slideIframe) {
    slideIframe.style.width = `${width}px`;
    slideIframe.style.height = `${height}px`;
  }
}

async function loadEditorConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    const w = cfg?.framePx?.width;
    const h = cfg?.framePx?.height;
    if (w && h) {
      setSlideFrame(w, h);
      applySlideFrameCss(w, h);
    }
    if (cfg?.slideMode && document?.body) {
      document.body.dataset.slideMode = cfg.slideMode;
    }
    if (cfg?.viewOnly && document?.body) {
      document.body.classList.add('view-only');
      document.title = 'Slide Viewer - slides-grab';
    }
  } catch {
    // Defaults (960x540) stay in effect.
  }
}

// Init
async function init() {
  setStatus('Loading slide list...');

  await loadEditorConfig();

  try {
    const res = await fetch('/api/slides');
    if (!res.ok) {
      throw new Error(`Failed to fetch slide list: ${res.status}`);
    }

    state.slides = await res.json();

    if (state.slides.length === 0) {
      setStatus('No slides found.');
      slideCounter.textContent = '0 / 0';
      return;
    }

    await loadModelOptions();
    await loadNarration();
    updateToolModeUI();
    await goToSlide(0);
    scaleSlide();
    await loadRunsInitial();
    connectSSE();

    setStatus(`Ready. Model: ${state.selectedModel}. Draw red pending bboxes, run Codex, then review green bboxes.`);
  } catch (error) {
    setStatus(`Error loading slides: ${error.message}`);
    console.error('Init error:', error);
  }
}

init();
