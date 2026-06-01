import { state } from './editor-state.js';
import {
  narrationTextInput,
  narrationVoiceSelect,
  narrationInstructionsInput,
  btnNarrationGenerate,
  btnNarrationSave,
  btnNarrationPlay,
  btnNarrationStop,
  btnViewNarrationPlay,
  btnViewNarrationStop,
  narrationAudio,
  narrationStatus,
} from './editor-dom.js';
import { currentSlideFile, setStatus } from './editor-utils.js';

const DEFAULT_VOICE = 'marin';

function getEntry(slide = currentSlideFile()) {
  if (!slide) return { text: '', voice: DEFAULT_VOICE, instructions: '', audio: '', generatedAt: '' };
  const existing = state.narration.document.slides[slide] || {};
  return {
    text: typeof existing.text === 'string' ? existing.text : '',
    voice: typeof existing.voice === 'string' && existing.voice ? existing.voice : state.narration.defaultVoice || DEFAULT_VOICE,
    instructions: typeof existing.instructions === 'string' ? existing.instructions : '',
    audio: typeof existing.audio === 'string' ? existing.audio : '',
    generatedAt: typeof existing.generatedAt === 'string' ? existing.generatedAt : '',
  };
}

function audioUrlFor(slide, entry) {
  if (!slide || !entry?.audio) return '';
  const file = slide.replace(/\.html$/i, '.mp3');
  const suffix = entry.generatedAt ? `?t=${encodeURIComponent(entry.generatedAt)}` : '';
  return `/slides/assets/narration/${encodeURIComponent(file)}${suffix}`;
}

function setNarrationBusy(isBusy) {
  if (btnNarrationGenerate) btnNarrationGenerate.disabled = isBusy;
  if (btnNarrationSave) btnNarrationSave.disabled = isBusy;
}

function setNarrationMessage(message) {
  if (narrationStatus) narrationStatus.textContent = message;
}

function syncPlaybackControls(slide, entry) {
  const url = audioUrlFor(slide, entry);
  if (narrationAudio) {
    const absoluteUrl = url ? new URL(url, window.location.href).href : '';
    if (narrationAudio.src !== absoluteUrl) {
      narrationAudio.pause();
      narrationAudio.removeAttribute('src');
      if (url) narrationAudio.src = url;
    }
  }
  const hasAudio = Boolean(url);
  if (btnNarrationPlay) btnNarrationPlay.disabled = !hasAudio;
  if (btnNarrationStop) btnNarrationStop.disabled = !hasAudio;
  if (btnViewNarrationPlay) btnViewNarrationPlay.disabled = !hasAudio;
  if (btnViewNarrationStop) btnViewNarrationStop.disabled = !hasAudio;
}

function setLocalEntry(slide, entry) {
  if (!slide) return;
  state.narration.document.slides[slide] = {
    ...getEntry(slide),
    ...entry,
  };
}

export function syncNarrationPanel() {
  const slide = currentSlideFile();
  const entry = getEntry(slide);
  if (narrationTextInput && document.activeElement !== narrationTextInput) {
    narrationTextInput.value = entry.text;
  }
  if (narrationVoiceSelect) {
    narrationVoiceSelect.value = entry.voice || state.narration.defaultVoice || DEFAULT_VOICE;
  }
  if (narrationInstructionsInput && document.activeElement !== narrationInstructionsInput) {
    narrationInstructionsInput.value = entry.instructions;
  }
  syncPlaybackControls(slide, entry);
  setNarrationMessage(entry.audio ? `Ready: ${entry.audio}` : 'No generated audio for this slide.');
}

export async function loadNarration() {
  try {
    const res = await fetch('/api/narration');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    state.narration.document = {
      schemaVersion: payload.schemaVersion || 1,
      slides: payload.slides && typeof payload.slides === 'object' ? payload.slides : {},
    };
    state.narration.voices = Array.isArray(payload.voices) ? payload.voices : [];
    state.narration.defaultVoice = payload.defaultVoice || DEFAULT_VOICE;
    if (narrationVoiceSelect && state.narration.voices.length > 0) {
      narrationVoiceSelect.innerHTML = state.narration.voices
        .map((voice) => `<option value="${voice}">${voice}</option>`)
        .join('');
    }
    syncNarrationPanel();
  } catch (error) {
    setNarrationMessage(`Narration unavailable: ${error.message}`);
  }
}

function collectNarrationForm() {
  return {
    text: narrationTextInput?.value || '',
    voice: narrationVoiceSelect?.value || state.narration.defaultVoice || DEFAULT_VOICE,
    instructions: narrationInstructionsInput?.value || '',
  };
}

export async function saveNarration({ silent = false } = {}) {
  const slide = currentSlideFile();
  if (!slide) return null;
  const payload = collectNarrationForm();
  setNarrationBusy(true);
  try {
    const res = await fetch(`/api/narration/${encodeURIComponent(slide)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setLocalEntry(slide, body.entry || payload);
    syncNarrationPanel();
    if (!silent) {
      setStatus(`Narration saved for ${slide}.`);
      setNarrationMessage('Narration text saved.');
    }
    return body.entry;
  } catch (error) {
    setStatus(`Narration save failed: ${error.message}`);
    setNarrationMessage(`Save failed: ${error.message}`);
    return null;
  } finally {
    setNarrationBusy(false);
  }
}

export async function generateNarrationSpeech() {
  const slide = currentSlideFile();
  if (!slide) return;
  const payload = collectNarrationForm();
  if (!payload.text.trim()) {
    setNarrationMessage('Narration text is required.');
    setStatus('Narration text is required.');
    return;
  }

  setNarrationBusy(true);
  setNarrationMessage('Generating speech...');
  try {
    const res = await fetch(`/api/narration/${encodeURIComponent(slide)}/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setLocalEntry(slide, body.entry || payload);
    syncNarrationPanel();
    if (body.reused) {
      setStatus(`Loaded saved narration for ${slide}.`);
      setNarrationMessage('Using saved generated audio.');
    } else {
      setStatus(`Generated narration for ${slide}.`);
      setNarrationMessage(`Generated and saved ${body.bytes || 0} bytes.`);
    }
  } catch (error) {
    setStatus(`Narration generation failed: ${error.message}`);
    setNarrationMessage(`Generate failed: ${error.message}`);
  } finally {
    setNarrationBusy(false);
  }
}

export function playNarration() {
  if (!narrationAudio?.src) return;
  void narrationAudio.play().catch((error) => {
    setNarrationMessage(`Playback failed: ${error.message}`);
  });
}

export function stopNarration() {
  if (!narrationAudio) return;
  narrationAudio.pause();
  narrationAudio.currentTime = 0;
}

export function bindNarrationEvents() {
  narrationTextInput?.addEventListener('input', () => {
    const slide = currentSlideFile();
    if (slide) setLocalEntry(slide, { text: narrationTextInput.value });
  });
  narrationVoiceSelect?.addEventListener('change', () => {
    const slide = currentSlideFile();
    if (slide) setLocalEntry(slide, { voice: narrationVoiceSelect.value });
  });
  narrationInstructionsInput?.addEventListener('input', () => {
    const slide = currentSlideFile();
    if (slide) setLocalEntry(slide, { instructions: narrationInstructionsInput.value });
  });
  btnNarrationSave?.addEventListener('click', () => {
    void saveNarration();
  });
  btnNarrationGenerate?.addEventListener('click', () => {
    void generateNarrationSpeech();
  });
  btnNarrationPlay?.addEventListener('click', playNarration);
  btnNarrationStop?.addEventListener('click', stopNarration);
  btnViewNarrationPlay?.addEventListener('click', playNarration);
  btnViewNarrationStop?.addEventListener('click', stopNarration);
}
