#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_TTS_VOICE,
  MAX_TTS_INPUT_CHARS,
  TTS_VOICES,
  generateSpeechForSlide,
  normalizeSlideFilename,
  normalizeVoice,
  readNarration,
} from '../src/narration.js';
import { loadLocalEnv } from '../src/local-env.js';

const DEFAULT_SLIDES_DIR = 'slides';
const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;

loadLocalEnv();

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/narrate.js [options]',
      '',
      'Options:',
      `  --slides-dir <path>  Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      '  --slide <file>       Generate only one slide (repeatable)',
      `  --voice <voice>      Default voice for entries without a voice (default: ${DEFAULT_TTS_VOICE})`,
      '  -h, --help           Show this help message',
      '',
      'Environment:',
      '  OPENAI_API_KEY       Required for speech generation',
      '',
      `Voices: ${TTS_VOICES.join(', ')}`,
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (!next || next.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return next;
}

function toSlideOrder(fileName) {
  const match = fileName.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

function sortSlideFiles(a, b) {
  const orderA = toSlideOrder(a);
  const orderB = toSlideOrder(b);
  if (orderA !== orderB) return orderA - orderB;
  return a.localeCompare(b);
}

export function parseCliArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    slides: [],
    voice: DEFAULT_TTS_VOICE,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--slides-dir') {
      options.slidesDir = readOptionValue(args, index, '--slides-dir');
      index += 1;
      continue;
    }

    if (arg.startsWith('--slides-dir=')) {
      options.slidesDir = arg.slice('--slides-dir='.length);
      continue;
    }

    if (arg === '--slide') {
      options.slides.push(normalizeSlideFilename(readOptionValue(args, index, '--slide'), '--slide'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--slide=')) {
      options.slides.push(normalizeSlideFilename(arg.slice('--slide='.length), '--slide'));
      continue;
    }

    if (arg === '--voice') {
      options.voice = normalizeVoice(readOptionValue(args, index, '--voice'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--voice=')) {
      options.voice = normalizeVoice(arg.slice('--voice='.length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (typeof options.slidesDir !== 'string' || options.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }

  options.slidesDir = options.slidesDir.trim();
  return options;
}

export async function findSlideFiles(slidesDir) {
  const entries = await readdir(slidesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SLIDE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(sortSlideFiles);
}

export function selectNarrationSlides(allSlides, selectedSlides, narrationDocument) {
  const selected = selectedSlides.length > 0 ? selectedSlides : allSlides;
  return selected.filter((slide) => {
    const entry = narrationDocument.slides[slide];
    return typeof entry?.text === 'string' && entry.text.trim().length > 0;
  });
}

async function main(args = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  if (options.help) {
    printUsage();
    return;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  const allSlides = await findSlideFiles(slidesDir);
  if (allSlides.length === 0) {
    throw new Error(`No slide-*.html files found in: ${slidesDir}`);
  }
  for (const slide of options.slides) {
    if (!allSlides.includes(slide)) {
      throw new Error(`Slide not found: ${slide}`);
    }
  }

  const narrationDocument = await readNarration(slidesDir);
  for (const slide of Object.keys(narrationDocument.slides)) {
    if (!narrationDocument.slides[slide].voice) {
      narrationDocument.slides[slide].voice = options.voice;
    }
  }

  const slides = selectNarrationSlides(allSlides, options.slides, narrationDocument);
  if (slides.length === 0) {
    throw new Error(`No narration text found. Add text to ${slidesDir}\\narration.json first.`);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for narration speech generation.');
  }

  for (const slide of slides) {
    const textLength = narrationDocument.slides[slide]?.text?.trim().length ?? 0;
    if (textLength > MAX_TTS_INPUT_CHARS) {
      throw new Error(`${slide}: narration text is too long. Max ${MAX_TTS_INPUT_CHARS} characters.`);
    }
    const result = await generateSpeechForSlide({ slidesDir, slide });
    process.stdout.write(`Generated ${slide}: ${result.audioPath}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
