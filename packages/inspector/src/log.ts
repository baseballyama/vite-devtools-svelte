import process from 'node:process';

const NAMESPACE = 'vite-devtools-svelte:inspector';
export const PREFIX = `[${NAMESPACE}]`;

function matches(pattern: string, name: string): boolean {
  const parts = pattern.split('*');
  const first = parts.shift() ?? '';
  const last = parts.pop();
  if (last === undefined) return pattern === name;
  if (!name.startsWith(first) || !name.endsWith(last)) return false;
  let at = first.length;
  for (const part of parts) {
    const found = name.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  return at <= name.length - last.length;
}

const SEPARATORS = new Set([',', ' ', '\t', '\n', '\r']);

// `DEBUG` as the `debug` package reads it (comma or whitespace separated, `*` wildcards, `-`
// excludes), read on each call so a `DEBUG` set after import (tests) applies
function debugEnabled(): boolean {
  const patterns = Array.from(process.env.DEBUG ?? '', c => (SEPARATORS.has(c) ? ' ' : c))
    .join('')
    .split(' ')
    .filter(Boolean);
  const excluded = patterns.some(p => p.startsWith('-') && matches(p.slice(1), NAMESPACE));
  return !excluded && patterns.some(p => !p.startsWith('-') && matches(p, NAMESPACE));
}

// console is looked up on each call, so patches made after import (tests, other tools) apply
export const log = {
  debug(message: string, payload?: unknown): void {
    if (!debugEnabled()) return;
    if (payload === undefined) console.error(`${PREFIX} ${message}`);
    else console.error(`${PREFIX} ${message}`, payload);
  },
  warn(message: string, payload?: unknown): void {
    if (payload === undefined) console.warn(`${PREFIX} ${message}`);
    else console.warn(`${PREFIX} ${message}`, payload);
  },
};
