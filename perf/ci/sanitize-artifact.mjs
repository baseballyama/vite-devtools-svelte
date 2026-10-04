#!/usr/bin/env node
// Copy perf results into an artifact directory, redact runner paths, then
// fail closed: if any token-like string or absolute path survives, exit 1 and
// write only file names + pattern ids (never the matched text). The workflow
// uploads the artifact only when this script succeeded.
//
// Usage: node perf/ci/sanitize-artifact.mjs <src-dir>... --out=<dir>
// Only text results are copied (.json .md .txt .cpuprofile .log); images are
// dropped because they cannot be scanned for codes or paths.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const out = args.find(a => a.startsWith('--out='))?.slice(6)
const srcs = args.filter(a => !a.startsWith('--'))
if (!out || srcs.length === 0) throw new Error('usage: sanitize-artifact.mjs <src>... --out=<dir>')

const TEXT = /\.(json|md|txt|cpuprofile|log)$/
const roots = [
  process.env.GITHUB_WORKSPACE,
  process.env.RUNNER_TEMP,
  process.env.RUNNER_TOOL_CACHE,
  os.homedir(),
  '/home/runner',
  '/opt/hostedtoolcache',
]
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const redact = text => {
  let t = text
  for (const [i, r] of roots.entries()) t = t.replace(new RegExp(esc(r), 'g'), `<root${i}>`)
  // devframe one-time codes and trusted-token query strings
  t = t.replace(/(auth code\s+)\d{6}/g, '$1<otp>')
  t = t.replace(/(devframe_otp=)\d{6}/g, '$1<otp>')
  t = t.replace(/([?&](?:token|auth|devframe_token)=)[^&\s"']+/g, '$1<redacted>')
  return t
}

const FORBIDDEN = [
  ['abs-home-path', /\/home\/[a-z_][\w-]*\//],
  ['abs-mac-path', /\/Users\/[^/\s"]+\//],
  ['abs-tmp-path', /\/(?:tmp|private\/tmp|var\/folders)\/[^\s"]+/],
  ['gh-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['otp', /(auth code\s+|devframe_otp=)\d{6}/],
  ['token-param', /[?&](?:token|auth|devframe_token)=(?!<redacted>)[^&\s"']+/],
  ['bearer', /\bBearer\s+[A-Za-z0-9._-]{16,}/],
]

let files = 0
const hits = []
const walk = (src, dst) => {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dst, ent.name)
    if (ent.isDirectory()) walk(s, d)
    else if (TEXT.test(ent.name)) {
      const text = redact(fs.readFileSync(s, 'utf8'))
      for (const [id, re] of FORBIDDEN)
        if (re.test(text)) hits.push({ file: path.relative(out, d), id })
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.writeFileSync(d, text)
      files++
    }
  }
}
fs.rmSync(out, { recursive: true, force: true })
for (const src of srcs) if (fs.existsSync(src)) walk(src, path.join(out, path.basename(src)))
if (hits.length) {
  // fail closed: drop everything that was copied
  fs.rmSync(out, { recursive: true, force: true })
  console.error(`sanitize: ${hits.length} forbidden match(es); artifact withheld`)
  for (const h of hits) console.error(`  ${h.file}: ${h.id}`)
  process.exit(1)
}
console.log(`sanitize: ${files} text file(s) copied, 0 forbidden matches`)
