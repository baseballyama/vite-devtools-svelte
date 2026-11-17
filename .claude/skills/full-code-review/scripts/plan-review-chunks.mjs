#!/usr/bin/env node
// Splits the changes under review into chunks small enough for one reviewer
// to read closely. Scope = everything that differs from the merge base with
// the base branch: commits, uncommitted edits and untracked files.
//
// Usage: node plan-review-chunks.mjs [base] [--format=md]
//   base defaults to $BASE_BRANCH, then origin/main.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--')) ?? process.env['BASE_BRANCH'] ?? 'origin/main';
const format = args.includes('--format=md') ? 'md' : 'json';

const MAX_LINES = 500;
const MAX_FILES = 10;
// A directory change closes the chunk once it has this much in it.
const SOFT_LINES = 200;
const SOFT_FILES = 5;

// execFileSync, not a shell: `base` comes from argv/env.
const git = gitArgs => execFileSync('git', gitArgs, { encoding: 'utf8' });

const mergeBase = git(['merge-base', base, 'HEAD']).trim();

const files = new Map();
// Without `..HEAD` the diff runs against the working tree, so uncommitted
// edits are included.
// Binary files report `-` instead of a line count.
const count = n => (n === '-' ? 0 : Number(n));
// `--no-renames`: a rename is reviewed as a delete plus an add, and every
// `-z` record stays `adds<TAB>dels<TAB>path`.
for (const line of git(['diff', '--numstat', '--no-renames', '-z', mergeBase]).split('\0')) {
  if (!line) continue;
  const [adds = '0', dels = '0', ...rest] = line.split('\t');
  const path = rest.join('\t');
  if (path) files.set(path, count(adds) + count(dels));
}
for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
  if (!path || files.has(path)) continue;
  let lines = 0;
  try {
    const buf = readFileSync(path);
    // Same heuristic as git: a NUL byte means binary, which has no lines.
    if (!buf.includes(0)) lines = buf.toString('utf8').split('\n').length;
  } catch {
    // Unreadable (e.g. a directory symlink): list it without a size.
  }
  files.set(path, lines);
}

const PKG = 'packages/vite-devtools-svelte/';

/** Ordered by review priority: browser-injected code first, lockfile last. */
const CATEGORIES = [
  'runtime', // injected into the user's page
  'plugin', // Vite plugin, dev-server collector, RPC, MCP, analyzers
  'client', // DevTools UI, shipped in the plugin's dist/client
  'inspector',
  'skills', // agent skills shipped in the npm package
  'tests',
  'changeset',
  'config',
  'tooling', // CI, e2e, perf, scripts, repo agent config
  'apps', // playground, site, examples
  'docs',
  'lockfile',
  'other',
];

function categoryOf(path) {
  const isTest =
    ['.test.ts', '.test.js'].some(ext => path.endsWith(ext)) || path.includes('/test/');
  if (path === 'pnpm-lock.yaml') return 'lockfile';
  if (path.startsWith('.changeset/')) return path.endsWith('.md') ? 'changeset' : 'config';
  if (isTest && path.startsWith('packages/')) return 'tests';
  if (path.startsWith(`${PKG}src/runtime/`)) return 'runtime';
  if (path.startsWith(`${PKG}src/`)) return 'plugin';
  if (path.startsWith(`${PKG}skills/`)) return 'skills';
  if (path.startsWith('packages/client/')) return 'client';
  if (path.startsWith('packages/inspector/')) return 'inspector';
  for (const dir of ['.github/', '.claude/', 'e2e/', 'perf/', 'scripts/']) {
    if (path.startsWith(dir)) return 'tooling';
  }
  for (const dir of ['playground/', 'site/', 'examples/']) {
    if (path.startsWith(dir)) return 'apps';
  }
  if (path.endsWith('.md') || path.startsWith('docs/')) return 'docs';
  if (!path.includes('/') || path.endsWith('package.json') || path.includes('tsconfig')) {
    return 'config';
  }
  return 'other';
}

const dirOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function commonPrefix(paths) {
  if (paths.length === 1) return paths[0];
  const split = paths.map(p => p.split('/'));
  const out = [];
  for (let i = 0; i < split[0].length - 1; i++) {
    if (!split.every(s => s[i] === split[0][i])) break;
    out.push(split[0][i]);
  }
  return out.length > 0 ? `${out.join('/')}/` : '(repo root)';
}

function chunk(category, list) {
  list.sort((a, b) => a.path.localeCompare(b.path));
  const groups = [];
  let cur = null;
  for (const f of list) {
    const close =
      cur !== null &&
      (cur.lines + f.lines > MAX_LINES ||
        cur.files.length >= MAX_FILES ||
        (cur.dir !== dirOf(f.path) && (cur.lines >= SOFT_LINES || cur.files.length >= SOFT_FILES)));
    if (cur === null || close) {
      cur = { files: [], lines: 0, dir: '' };
      groups.push(cur);
    }
    cur.files.push(f.path);
    cur.lines += f.lines;
    cur.dir = dirOf(f.path);
  }
  // Fold a small leftover into the previous chunk rather than review it alone.
  for (let i = groups.length - 1; i > 0; i--) {
    const [prev, g] = [groups[i - 1], groups[i]];
    const small = g.lines < SOFT_LINES / 2 && g.files.length <= 2;
    if (
      small &&
      prev.lines + g.lines <= MAX_LINES &&
      prev.files.length + g.files.length <= MAX_FILES
    ) {
      prev.files.push(...g.files);
      prev.lines += g.lines;
      groups.splice(i, 1);
    }
  }
  return groups.map((g, i) => ({
    category,
    name: `${category}${groups.length > 1 ? ` ${i + 1}/${groups.length}` : ''}: ${commonPrefix(g.files)}`,
    files: g.files,
    lines: g.lines,
  }));
}

const buckets = new Map(CATEGORIES.map(c => [c, []]));
for (const [path, lines] of files) buckets.get(categoryOf(path)).push({ path, lines });

const chunks = CATEGORIES.flatMap(c => chunk(c, buckets.get(c)));
for (const [i, c] of chunks.entries()) c.index = i + 1;

if (format === 'json') {
  console.log(JSON.stringify({ base, mergeBase, chunks }, null, 2));
} else {
  const out = [
    `Base: \`${base}\` (merge base \`${mergeBase.slice(0, 10)}\`), ${files.size} files, ${chunks.length} chunks`,
    '',
    '| # | Chunk | Files | Lines |',
    '|---|-------|-------|-------|',
    ...chunks.map(c => `| ${c.index} | ${c.name} | ${c.files.length} | ${c.lines} |`),
    '',
  ];
  for (const c of chunks) {
    out.push(`**${c.index}. ${c.name}**`);
    for (const file of c.files) out.push(`- \`${String(file)}\``);
    out.push('');
  }
  console.log(out.join('\n'));
}
