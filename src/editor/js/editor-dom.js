// editor-dom.js — DOM element references

const $ = (sel) => document.querySelector(sel);

export const btnPrev = $('#btn-prev');
export const btnNext = $('#btn-next');
export const slideCounter = $('#slide-counter');
export const slideStatusChip = $('#slide-status-chip');

export const slideIframe = $('#slide-iframe');
export const slidePanel = $('#slide-panel');
export const slideStage = $('#slide-stage');
export const slideWrapper = $('#slide-wrapper');
export const bboxLayer = $('#bbox-layer');
export const objectLayer = $('#object-layer');
export const objectHoverBox = $('#object-hover-box');
export const objectSelectedBox = $('#object-selected-box');
export const drawLayer = $('#draw-layer');
export const drawBox = $('#draw-box');
export const toolModeDrawBtn = $('#tool-mode-draw');
export const toolModeSelectBtn = $('#tool-mode-select');
export const toolModeNarrationBtn = $('#tool-mode-narration');
export const bboxToolbar = $('#bbox-toolbar');
export const selectToolbar = $('#select-toolbar');
export const narrationToolbar = $('#narration-toolbar');

export const toggleBold = $('#toggle-bold');
export const toggleItalic = $('#toggle-italic');
export const toggleUnderline = $('#toggle-underline');
export const toggleStrike = $('#toggle-strike');
export const alignLeft = $('#align-left');
export const alignCenter = $('#align-center');
export const alignRight = $('#align-right');
export const popoverTextInput = $('#popover-text-input');
export const popoverApplyText = $('#popover-apply-text');
export const popoverTextColorInput = $('#popover-text-color-input');
export const popoverBgColorInput = $('#popover-bg-color-input');
export const popoverSizeInput = $('#popover-size-input');
export const popoverApplySize = $('#popover-apply-size');

export const chatMessagesEl = $('#chat-messages');
export const sessionFileChip = $('#session-file-chip');
export const contextChipList = $('#context-chip-list');
export const promptInput = $('#prompt-input');
export const modelSelect = $('#model-select');
export const btnClearBboxes = $('#btn-clear-bboxes');
export const bboxCountEl = $('#bbox-count');
export const btnSend = $('#btn-send');
export const editorHint = $('#editor-hint');
export const selectedObjectMini = $('#selected-object-mini');
export const miniTag = $('#mini-tag');
export const miniText = $('#mini-text');
export const selectEmptyHint = $('#select-empty-hint');
export const deleteSelectedObjectBtn = $('#delete-selected-object');
export const narrationTextInput = $('#narration-text-input');
export const narrationVoiceSelect = $('#narration-voice-select');
export const narrationInstructionsInput = $('#narration-instructions-input');
export const btnNarrationGenerate = $('#btn-narration-generate');
export const btnNarrationSave = $('#btn-narration-save');
export const btnNarrationPlay = $('#btn-narration-play');
export const btnNarrationStop = $('#btn-narration-stop');
export const btnViewNarrationPlay = $('#btn-view-narration-play');
export const btnViewNarrationStop = $('#btn-view-narration-stop');
export const narrationAudio = $('#narration-audio');
export const narrationStatus = $('#narration-status');

export const statusDot = $('#status-dot');
export const statusConn = $('#status-connection');
export const statusMsg = $('#status-message');
