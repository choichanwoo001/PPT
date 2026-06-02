#!/usr/bin/env node

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_IMAGES_DIR = 'out-png-selected';
const DEFAULT_NARRATION_FILE = 'narration.json';
const DEFAULT_OUTPUT = 'presentation-tts.mp4';
const DEFAULT_TTS_RATE = 1.5;

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/tts-slideshow-video.js [options]',
      '',
      'Options:',
      `  --slides-dir <path>      Slides directory (default: ${DEFAULT_SLIDES_DIR})`,
      `  --images-dir <path>      PNG directory under slides-dir (default: ${DEFAULT_IMAGES_DIR})`,
      `  --narration <file>       Narration json filename under slides-dir (default: ${DEFAULT_NARRATION_FILE})`,
      `  --output <file>          Output video path (default: <slides-dir>/${DEFAULT_OUTPUT})`,
      '  --fps <number>           Output FPS (default: 30)',
      `  --tts-rate <number>      Narration playback speed (default: ${DEFAULT_TTS_RATE})`,
      '  -h, --help               Show help',
      '',
      'Example:',
      '  node scripts/tts-slideshow-video.js --slides-dir slides --images-dir out-png-selected --output slides/presentation-tts.mp4',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (!next || next.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return next;
}

function parseArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    imagesDir: DEFAULT_IMAGES_DIR,
    narrationFile: DEFAULT_NARRATION_FILE,
    output: '',
    fps: 30,
    ttsRate: DEFAULT_TTS_RATE,
    help: false,
  };
  const positionalArgs = [];

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
    if (arg === '--images-dir') {
      options.imagesDir = readOptionValue(args, index, '--images-dir');
      index += 1;
      continue;
    }
    if (arg.startsWith('--images-dir=')) {
      options.imagesDir = arg.slice('--images-dir='.length);
      continue;
    }
    if (arg === '--narration') {
      options.narrationFile = readOptionValue(args, index, '--narration');
      index += 1;
      continue;
    }
    if (arg.startsWith('--narration=')) {
      options.narrationFile = arg.slice('--narration='.length);
      continue;
    }
    if (arg === '--output') {
      options.output = readOptionValue(args, index, '--output');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--fps') {
      options.fps = Number.parseInt(readOptionValue(args, index, '--fps'), 10);
      index += 1;
      continue;
    }
    if (arg.startsWith('--fps=')) {
      options.fps = Number.parseInt(arg.slice('--fps='.length), 10);
      continue;
    }
    if (arg === '--tts-rate') {
      options.ttsRate = Number.parseFloat(readOptionValue(args, index, '--tts-rate'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--tts-rate=')) {
      options.ttsRate = Number.parseFloat(arg.slice('--tts-rate='.length));
      continue;
    }

    if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  // npm/powershell 환경에서 --flag 이름이 제거되고 값만 전달되는 경우를 대비한 fallback.
  if (positionalArgs.length >= 1) {
    options.slidesDir = positionalArgs[0];
  }
  if (positionalArgs.length >= 2) {
    options.imagesDir = positionalArgs[1];
  }
  if (positionalArgs.length >= 3) {
    options.output = positionalArgs[2];
  }
  if (positionalArgs.length > 3) {
    throw new Error(`Too many positional arguments: ${positionalArgs.join(' ')}`);
  }

  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error('--fps must be a positive integer');
  }
  if (!Number.isFinite(options.ttsRate) || options.ttsRate <= 0) {
    throw new Error('--tts-rate must be a positive number');
  }
  return options;
}

function slideOrderFromName(name) {
  const match = name.match(/(\d+)/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number.parseInt(match[1], 10);
}

function sortSlideNames(a, b) {
  const aOrder = slideOrderFromName(a);
  const bOrder = slideOrderFromName(b);
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.localeCompare(b);
}

async function ensureReadable(path) {
  await access(path, fsConstants.R_OK);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function escapeConcatPath(path) {
  return path.replace(/'/g, "'\\''");
}

async function buildSegments({ slides, tempDir, fps, ttsRate }) {
  const segments = [];
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const segmentPath = join(tempDir, `segment-${String(index + 1).padStart(3, '0')}.mp4`);
    const filters = [`[1:a]atempo=${ttsRate.toFixed(3)}[narr]`];
    await runCommand('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      slide.imagePath,
      '-i',
      slide.audioPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-tune',
      'stillimage',
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v:0',
      '-map',
      '[narr]',
      '-r',
      String(fps),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      segmentPath,
    ]);
    segments.push(segmentPath);
  }
  return segments;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage();
    return;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  const narrationPath = resolve(slidesDir, options.narrationFile);
  const imagesDir = resolve(slidesDir, options.imagesDir);
  const outputPath = options.output
    ? resolve(process.cwd(), options.output)
    : resolve(slidesDir, DEFAULT_OUTPUT);

  const narrationRaw = await readFile(narrationPath, 'utf8');
  const narration = JSON.parse(narrationRaw);
  const entries = narration?.slides;
  if (!entries || typeof entries !== 'object') {
    throw new Error(`Invalid narration file format: ${narrationPath}`);
  }

  const slideNames = Object.keys(entries).sort(sortSlideNames);
  if (slideNames.length === 0) {
    throw new Error('No slide entries found in narration file.');
  }

  const slides = [];
  for (const htmlName of slideNames) {
    const base = basename(htmlName, '.html');
    const imagePath = resolve(imagesDir, `${base}.png`);
    const audioRaw = entries[htmlName]?.audio;
    if (typeof audioRaw !== 'string' || audioRaw.trim() === '') {
      continue;
    }
    const audioPath = resolve(slidesDir, audioRaw);
    await ensureReadable(imagePath);
    await ensureReadable(audioPath);
    slides.push({ htmlName, imagePath, audioPath });
  }

  if (slides.length === 0) {
    throw new Error('No valid slide pairs found. Check narration audio paths and PNG exports.');
  }

  await runCommand('ffmpeg', ['-version']);
  await runCommand('ffprobe', ['-version']);

  const tempDir = await mkdtemp(join(tmpdir(), 'tts-slideshow-'));
  try {
    process.stdout.write(`Building ${slides.length} segments...\n`);
    const segments = await buildSegments({
      slides,
      tempDir,
      fps: options.fps,
      ttsRate: options.ttsRate,
    });

    const concatListPath = join(tempDir, 'concat-list.txt');
    const concatContent = segments.map((seg) => `file '${escapeConcatPath(seg)}'`).join('\n');
    await writeFile(concatListPath, `${concatContent}\n`, 'utf8');

    process.stdout.write('Merging segments...\n');
    await runCommand('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      outputPath,
    ]);

    process.stdout.write(`Done: ${outputPath}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
