#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const explicitBaseBranch = args.find((a) => !a.startsWith('--')) ?? process.env.BASE_BRANCH ?? null;
const format = args.includes('--format=md') ? 'md' : 'json';

const MAX_LINES_PER_CHUNK = 500;
const MAX_FILES_PER_CHUNK = 10;
const SOFT_BREAK_MIN_LINES = 200;
const SOFT_BREAK_MIN_FILES = 5;

// argv/環境変数経由で来るブランチ名にシェルメタ文字が混じる可能性があるため、
// shell 経由の execSync ではなく execFileSync (引数配列) でコマンドインジェクションを防ぐ。
function tryGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function branchExists(ref) {
  return tryGit(['rev-parse', '--verify', '--quiet', ref]) !== null;
}

function selectBaseBranch() {
  if (branchExists('origin/main')) return 'origin/main';
  if (branchExists('origin/master')) return 'origin/master';
  throw new Error(
    'Neither origin/main nor origin/master exists. Run `git fetch origin` or pass a base branch explicitly.',
  );
}

const baseBranch = explicitBaseBranch ?? selectBaseBranch();

// `...` (symmetric difference) は commit 同士でしか動かない。
// リポジトリ全体をレビュー対象にする際の empty-tree 指定 (4b825dc6...) のために、
// base が「commit でない (= tree やオブジェクト hash)」場合は `..` (two-dot) を使う。
const isCommit = tryGit(['rev-parse', '--verify', `${baseBranch}^{commit}`]) !== null;
const diffRange = isCommit ? `${baseBranch}...HEAD` : `${baseBranch}..HEAD`;

const raw = execFileSync('git', ['diff', '--numstat', diffRange], {
  encoding: 'utf8',
});

const files = raw
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const parts = line.split('\t');
    const adds = parts[0] === '-' ? 0 : Number(parts[0]);
    const dels = parts[1] === '-' ? 0 : Number(parts[1]);
    const path = parts.slice(2).join('\t');
    return { path, lines: adds + dels };
  })
  .filter((f) => f.path && f.lines >= 0);

// vite-devtools-svelte 固有のカテゴリ分類:
// - runtime: src/runtime.ts は browser-injected コードで独立してレビューしたいため別カテゴリ
// - plugin: src/ 配下の他のファイル (plugin.ts / analyzers / types.ts)
// - tests:  src/__tests__/ 配下
// - client: client/ 配下 (DevTools UI)
// - playground / site: デモアプリ
// - config: ルート直下の package.json / tsconfig / *.config.*
// - docs:   README / ROADMAP / docs/
// - other:  その他
const PKG_PREFIX = 'packages/vite-devtools-svelte/';
function categoryOf(path) {
  if (path === `${PKG_PREFIX}src/runtime.ts`) return 'runtime';
  if (path.startsWith(`${PKG_PREFIX}src/__tests__/`)) return 'tests';
  if (path.startsWith(`${PKG_PREFIX}src/`)) return 'plugin';
  if (path.startsWith(`${PKG_PREFIX}client/`)) return 'client';
  if (path.startsWith('playground/')) return 'playground';
  if (path.startsWith('site/')) return 'site';
  if (path.startsWith('docs/') || path === 'README.md' || path === 'ROADMAP.md') return 'docs';
  // ルート直下の設定ファイル
  if (
    !path.includes('/') &&
    (/\.(json|ya?ml|toml|js|mjs|cjs|ts|mts|cts)$/.test(path) || path === 'package.json')
  ) {
    return 'config';
  }
  return 'other';
}

function dirKey(path) {
  const segs = path.split('/');
  return segs.slice(0, Math.min(segs.length - 1, 6)).join('/');
}

function commonDir(paths) {
  if (paths.length === 0) return '';
  if (paths.length === 1) return paths[0];
  const splits = paths.map((p) => p.split('/'));
  const minLen = Math.min(...splits.map((s) => s.length));
  const out = [];
  for (let i = 0; i < minLen - 1; i++) {
    const seg = splits[0][i];
    if (splits.every((s) => s[i] === seg)) out.push(seg);
    else break;
  }
  return out.length > 0 ? out.join('/') + '/' : '<mixed>';
}

function chunkFiles(category, list) {
  if (list.length === 0) return [];
  list.sort((a, b) => a.path.localeCompare(b.path));

  const chunks = [];
  let current = { files: [], lines: 0, dir: null };

  for (const f of list) {
    const fileDir = dirKey(f.path);
    const dirChanged = current.dir !== null && current.dir !== fileDir;
    const wouldExceedLines = current.lines + f.lines > MAX_LINES_PER_CHUNK;
    const wouldExceedFiles = current.files.length + 1 > MAX_FILES_PER_CHUNK;
    const reachedSoftBreak =
      current.lines >= SOFT_BREAK_MIN_LINES || current.files.length >= SOFT_BREAK_MIN_FILES;

    const shouldFinalize =
      current.files.length > 0 &&
      (wouldExceedLines || wouldExceedFiles || (dirChanged && reachedSoftBreak));

    if (shouldFinalize) {
      chunks.push(current);
      current = { files: [], lines: 0, dir: null };
    }

    current.files.push(f);
    current.lines += f.lines;
    current.dir = fileDir;
  }
  if (current.files.length > 0) chunks.push(current);

  return chunks.map((c, i) => ({
    categoryIndex: i + 1,
    categoryTotal: chunks.length,
    category,
    name:
      chunks.length > 1
        ? `${category} ${i + 1}/${chunks.length}: ${commonDir(c.files.map((x) => x.path))}`
        : `${category}: ${commonDir(c.files.map((x) => x.path))}`,
    files: c.files.map((x) => x.path),
    totalLines: c.lines,
    fileCount: c.files.length,
  }));
}

const buckets = {
  plugin: [],
  runtime: [],
  client: [],
  tests: [],
  playground: [],
  site: [],
  config: [],
  docs: [],
  other: [],
};
for (const f of files) {
  const cat = categoryOf(f.path);
  buckets[cat].push(f);
}

// レビュー優先順位の高い順に並べる: plugin (RPC / analyzer / 型) → runtime (browser injected)
// → client (UI) → tests → 周辺 (playground/site/config/docs/other)
const merged = [
  ...chunkFiles('plugin', buckets.plugin),
  ...chunkFiles('runtime', buckets.runtime),
  ...chunkFiles('client', buckets.client),
  ...chunkFiles('tests', buckets.tests),
  ...chunkFiles('playground', buckets.playground),
  ...chunkFiles('site', buckets.site),
  ...chunkFiles('config', buckets.config),
  ...chunkFiles('docs', buckets.docs),
  ...chunkFiles('other', buckets.other),
];

const totalChunks = merged.length;
const chunks = merged.map((c, i) => ({
  index: i + 1,
  total: totalChunks,
  categoryIndex: c.categoryIndex,
  categoryTotal: c.categoryTotal,
  category: c.category,
  name: c.name,
  files: c.files,
  totalLines: c.totalLines,
  fileCount: c.fileCount,
}));

const result = {
  baseBranch,
  thresholds: {
    maxLinesPerChunk: MAX_LINES_PER_CHUNK,
    maxFilesPerChunk: MAX_FILES_PER_CHUNK,
  },
  totalChunks,
  chunks,
};

if (format === 'md') {
  const lines = [
    `# Phase 3 Review Chunks`,
    ``,
    `Base branch: \`${baseBranch}\``,
    `Total chunks: **${totalChunks}**`,
    ``,
    `| # | Category | Chunk | Files | Lines |`,
    `|---|----------|-------|-------|-------|`,
    ...chunks.map(
      (c, i) => `| ${i + 1} | ${c.category} | ${c.name} | ${c.fileCount} | ${c.totalLines} |`,
    ),
    ``,
    `## Files per chunk`,
    ``,
    ...chunks.flatMap((c, i) => [
      `### ${i + 1}. ${c.name} (${c.fileCount} files, ${c.totalLines} lines)`,
      ``,
      ...c.files.map((f) => `- \`${f}\``),
      ``,
    ]),
  ];
  console.log(lines.join('\n'));
} else {
  console.log(JSON.stringify(result, null, 2));
}
