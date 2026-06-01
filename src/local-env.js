import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;

  let value = match[2] ?? '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex);
    value = value.trim();
  }

  return { key: match[1], value };
}

export function loadLocalEnv({ cwd = process.cwd(), files = ['.env.local', '.env'] } = {}) {
  const loaded = [];

  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;

    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] !== undefined) continue;
      process.env[parsed.key] = parsed.value;
    }
    loaded.push(path);
  }

  return loaded;
}
