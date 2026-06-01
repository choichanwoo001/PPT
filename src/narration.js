import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const NARRATION_FILE = 'narration.json';
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_TTS_VOICE = 'marin';
export const DEFAULT_RESPONSE_FORMAT = 'mp3';
export const MAX_TTS_INPUT_CHARS = 4096;
export const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
export const TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];

const voiceSet = new Set(TTS_VOICES);

export function normalizeSlideFilename(rawSlide, source = 'slide') {
  const slide = typeof rawSlide === 'string' ? basename(rawSlide.trim()) : '';
  if (!slide || !SLIDE_FILE_PATTERN.test(slide)) {
    throw new Error(`Missing or invalid ${source}.`);
  }
  return slide;
}

export function getNarrationPath(slidesDir) {
  return join(slidesDir, NARRATION_FILE);
}

export function getNarrationAudioFile(slide) {
  const normalizedSlide = normalizeSlideFilename(slide);
  return normalizedSlide.replace(/\.html$/i, '.mp3');
}

export function getNarrationAudioReference(slide) {
  return `./assets/narration/${getNarrationAudioFile(slide)}`;
}

export function getNarrationAudioPath(slidesDir, slide) {
  return join(slidesDir, 'assets', 'narration', getNarrationAudioFile(slide));
}

export function getNarrationAudioUrl(slide, cacheBust = '') {
  const suffix = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : '';
  return `/slides/assets/narration/${encodeURIComponent(getNarrationAudioFile(slide))}${suffix}`;
}

export function normalizeVoice(rawVoice) {
  const voice = typeof rawVoice === 'string' ? rawVoice.trim() : '';
  if (!voice) return DEFAULT_TTS_VOICE;
  if (!voiceSet.has(voice)) {
    throw new Error(`Invalid voice "${voice}". Allowed voices: ${TTS_VOICES.join(', ')}.`);
  }
  return voice;
}

export function normalizeText(rawText) {
  return typeof rawText === 'string' ? rawText : '';
}

export function normalizeInstructions(rawInstructions) {
  return typeof rawInstructions === 'string' ? rawInstructions : '';
}

export function ensureTtsInput(text) {
  const input = normalizeText(text).trim();
  if (!input) {
    throw new Error('Narration text is required.');
  }
  if (input.length > MAX_TTS_INPUT_CHARS) {
    throw new Error(`Narration text is too long. Max ${MAX_TTS_INPUT_CHARS} characters.`);
  }
  return input;
}

export function normalizeNarrationEntry(rawEntry = {}) {
  const voice = normalizeVoice(rawEntry.voice);
  const text = normalizeText(rawEntry.text);
  const instructions = normalizeInstructions(rawEntry.instructions);
  const audio = typeof rawEntry.audio === 'string' ? rawEntry.audio : '';
  const updatedAt = typeof rawEntry.updatedAt === 'string' ? rawEntry.updatedAt : '';
  const generatedAt = typeof rawEntry.generatedAt === 'string' ? rawEntry.generatedAt : '';
  return {
    text,
    voice,
    instructions,
    audio,
    updatedAt,
    generatedAt,
  };
}

export function createEmptyNarration() {
  return {
    schemaVersion: 1,
    slides: {},
  };
}

export function normalizeNarrationDocument(rawDocument = {}) {
  const document = createEmptyNarration();
  const rawSlides = rawDocument && typeof rawDocument === 'object' ? rawDocument.slides : null;
  if (!rawSlides || typeof rawSlides !== 'object') {
    return document;
  }

  for (const [rawSlide, rawEntry] of Object.entries(rawSlides)) {
    try {
      const slide = normalizeSlideFilename(rawSlide);
      document.slides[slide] = normalizeNarrationEntry(rawEntry);
    } catch {
      // Ignore stale or malformed keys so one bad entry does not break the deck.
    }
  }

  return document;
}

export async function readNarration(slidesDir) {
  try {
    const raw = await readFile(getNarrationPath(slidesDir), 'utf8');
    return normalizeNarrationDocument(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createEmptyNarration();
    }
    throw error;
  }
}

export async function writeNarration(slidesDir, document) {
  const normalized = normalizeNarrationDocument(document);
  await writeFile(getNarrationPath(slidesDir), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function saveNarrationEntry(slidesDir, slide, patch, now = new Date()) {
  const normalizedSlide = normalizeSlideFilename(slide);
  const document = await readNarration(slidesDir);
  const previous = normalizeNarrationEntry(document.slides[normalizedSlide]);
  const textChanged = Object.hasOwn(patch, 'text') && normalizeText(patch.text) !== previous.text;
  const voiceChanged = Object.hasOwn(patch, 'voice') && normalizeVoice(patch.voice) !== previous.voice;
  const instructionsChanged =
    Object.hasOwn(patch, 'instructions') && normalizeInstructions(patch.instructions) !== previous.instructions;
  const next = normalizeNarrationEntry({
    ...previous,
    ...patch,
    ...(textChanged || voiceChanged || instructionsChanged ? { audio: '', generatedAt: '' } : {}),
    updatedAt: now.toISOString(),
  });

  document.slides[normalizedSlide] = next;
  await writeNarration(slidesDir, document);
  return next;
}

export function buildSpeechRequestBody(entry) {
  const input = ensureTtsInput(entry.text);
  const body = {
    model: DEFAULT_TTS_MODEL,
    voice: normalizeVoice(entry.voice),
    input,
    response_format: DEFAULT_RESPONSE_FORMAT,
  };
  const instructions = normalizeInstructions(entry.instructions).trim();
  if (instructions) {
    body.instructions = instructions;
  }
  return body;
}

export async function requestSpeechAudio({ apiKey, entry, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for narration speech generation.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSpeechRequestBody(entry)),
  });

  if (!response.ok) {
    const detail = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
    throw new Error(`OpenAI request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateSpeechForSlide({
  slidesDir,
  slide,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const normalizedSlide = normalizeSlideFilename(slide);
  const document = await readNarration(slidesDir);
  const entry = normalizeNarrationEntry(document.slides[normalizedSlide]);
  const audioBytes = await requestSpeechAudio({ apiKey, entry, fetchImpl });

  const narrationDir = join(slidesDir, 'assets', 'narration');
  await mkdir(narrationDir, { recursive: true });
  const audioPath = getNarrationAudioPath(slidesDir, normalizedSlide);
  await writeFile(audioPath, audioBytes);

  const nextEntry = normalizeNarrationEntry({
    ...entry,
    audio: getNarrationAudioReference(normalizedSlide),
    generatedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  document.slides[normalizedSlide] = nextEntry;
  await writeNarration(slidesDir, document);

  return {
    slide: normalizedSlide,
    entry: nextEntry,
    audioPath,
    audioUrl: getNarrationAudioUrl(normalizedSlide, now.getTime()),
    bytes: audioBytes.length,
  };
}

export async function getReusableSpeechForSlide({ slidesDir, slide } = {}) {
  const normalizedSlide = normalizeSlideFilename(slide);
  const document = await readNarration(slidesDir);
  const entry = normalizeNarrationEntry(document.slides[normalizedSlide]);
  if (!entry.audio) return null;

  const audioPath = getNarrationAudioPath(slidesDir, normalizedSlide);
  try {
    await access(audioPath);
  } catch {
    return null;
  }

  return {
    slide: normalizedSlide,
    entry,
    audioPath,
    audioUrl: getNarrationAudioUrl(normalizedSlide, entry.generatedAt || entry.updatedAt || Date.now()),
    bytes: 0,
    reused: true,
  };
}
