import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_TTS_INPUT_CHARS,
  buildSpeechRequestBody,
  generateSpeechForSlide,
  getReusableSpeechForSlide,
  normalizeSlideFilename,
  normalizeVoice,
  readNarration,
  requestSpeechAudio,
  saveNarrationEntry,
  writeNarration,
} from '../../src/narration.js';
import {
  parseCliArgs,
  selectNarrationSlides,
} from '../../scripts/narrate.js';
import { loadLocalEnv } from '../../src/local-env.js';

test('narrate CLI parses defaults and repeatable slide filters', () => {
  assert.deepEqual(parseCliArgs([]), {
    slidesDir: 'slides',
    slides: [],
    voice: 'marin',
    help: false,
  });
  assert.deepEqual(parseCliArgs([
    '--slides-dir',
    'decks/demo',
    '--slide',
    'slide-02.html',
    '--slide=slide-01.html',
    '--voice',
    'cedar',
  ]), {
    slidesDir: 'decks/demo',
    slides: ['slide-02.html', 'slide-01.html'],
    voice: 'cedar',
    help: false,
  });
  assert.throws(() => parseCliArgs(['--slide', 'notes.html']), /invalid/i);
  assert.throws(() => parseCliArgs(['--voice', 'nope']), /invalid voice/i);
  assert.throws(() => parseCliArgs(['--wat']), /unknown option/i);
});

test('narration validation enforces slide names, voices, and text length', () => {
  assert.equal(normalizeSlideFilename('dir/slide-01.html'), 'slide-01.html');
  assert.throws(() => normalizeSlideFilename('notes.html'), /invalid/i);
  assert.equal(normalizeVoice(''), 'marin');
  assert.equal(normalizeVoice('alloy'), 'alloy');
  assert.throws(() => normalizeVoice('robot'), /invalid voice/i);

  assert.throws(
    () => buildSpeechRequestBody({ text: 'x'.repeat(MAX_TTS_INPUT_CHARS + 1), voice: 'marin' }),
    /too long/i,
  );
});

test('narration.json round-trips independently from slide order', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'narration-json-'));
  const slidesDir = path.join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });

  try {
    await saveNarrationEntry(slidesDir, 'slide-10.html', {
      text: 'Last slide first.',
      voice: 'cedar',
      instructions: 'Calm tone.',
    }, new Date('2026-01-01T00:00:00.000Z'));
    await saveNarrationEntry(slidesDir, 'slide-01.html', {
      text: 'Opening.',
      voice: 'marin',
      instructions: '',
    }, new Date('2026-01-01T00:01:00.000Z'));

    const document = await readNarration(slidesDir);
    assert.equal(document.slides['slide-10.html'].text, 'Last slide first.');
    assert.equal(document.slides['slide-10.html'].voice, 'cedar');
    assert.equal(document.slides['slide-01.html'].text, 'Opening.');
    assert.deepEqual(
      selectNarrationSlides(['slide-01.html', 'slide-02.html', 'slide-10.html'], [], document),
      ['slide-01.html', 'slide-10.html'],
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('requestSpeechAudio sends the expected OpenAI speech payload', async () => {
  const calls = [];
  const bytes = Buffer.from('mp3-bytes');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };

  const result = await requestSpeechAudio({
    apiKey: 'sk-test',
    entry: {
      text: '안녕하세요.',
      voice: 'marin',
      instructions: 'Warm Korean presenter.',
    },
    fetchImpl,
  });

  assert.equal(result.toString(), 'mp3-bytes');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    input: '안녕하세요.',
    response_format: 'mp3',
    instructions: 'Warm Korean presenter.',
  });
});

test('generateSpeechForSlide writes mp3 and updates narration metadata', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'narration-generate-'));
  const slidesDir = path.join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });

  try {
    await saveNarrationEntry(slidesDir, 'slide-01.html', {
      text: 'Opening script.',
      voice: 'marin',
      instructions: '',
    });

    const result = await generateSpeechForSlide({
      slidesDir,
      slide: 'slide-01.html',
      apiKey: 'sk-test',
      now: new Date('2026-01-01T00:00:00.000Z'),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const buffer = Buffer.from('audio');
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
      }),
    });

    assert.match(result.audioPath, /slide-01\.mp3$/);
    assert.equal(result.entry.audio, './assets/narration/slide-01.mp3');
    assert.match(result.audioUrl, /\/slides\/assets\/narration\/slide-01\.mp3/);
    assert.equal((await readFile(result.audioPath)).toString(), 'audio');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('getReusableSpeechForSlide returns saved mp3 without another OpenAI call', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'narration-reuse-'));
  const slidesDir = path.join(workspace, 'slides');
  await mkdir(path.join(slidesDir, 'assets', 'narration'), { recursive: true });

  try {
    await writeNarration(slidesDir, {
      schemaVersion: 1,
      slides: {
        'slide-01.html': {
          text: 'Opening script.',
          voice: 'marin',
          instructions: '',
          audio: './assets/narration/slide-01.mp3',
          updatedAt: '2026-01-01T00:00:00.000Z',
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    await writeFile(path.join(slidesDir, 'assets', 'narration', 'slide-01.mp3'), 'audio', 'utf8');

    const result = await getReusableSpeechForSlide({ slidesDir, slide: 'slide-01.html' });
    assert.equal(result.reused, true);
    assert.equal(result.entry.audio, './assets/narration/slide-01.mp3');
    assert.match(result.audioUrl, /\/slides\/assets\/narration\/slide-01\.mp3/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('slides-grab help exposes the narrate command', () => {
  const output = execFileSync(process.execPath, ['bin/ppt-agent.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });

  assert.match(output, /\bnarrate\b/);
});

test('loadLocalEnv reads .env files without overriding process env', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'local-env-'));
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousCustom = process.env.NARRATION_TEST_KEY;

  try {
    process.env.OPENAI_API_KEY = 'existing-key';
    delete process.env.NARRATION_TEST_KEY;
    await writeFile(path.join(workspace, '.env'), [
      'OPENAI_API_KEY=from-file',
      'NARRATION_TEST_KEY="loaded value"',
    ].join('\n'), 'utf8');

    const loaded = loadLocalEnv({ cwd: workspace, files: ['.env'] });
    assert.equal(loaded.length, 1);
    assert.equal(process.env.OPENAI_API_KEY, 'existing-key');
    assert.equal(process.env.NARRATION_TEST_KEY, 'loaded value');
  } finally {
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
    if (previousCustom === undefined) delete process.env.NARRATION_TEST_KEY;
    else process.env.NARRATION_TEST_KEY = previousCustom;
    await rm(workspace, { recursive: true, force: true });
  }
});
