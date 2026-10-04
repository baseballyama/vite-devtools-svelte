#!/usr/bin/env node
// Re-aggregate a finished paired run from its raw items (no measurement):
//   node perf/resummarize.mjs --dir=playground/.temp/perf-results/<label> --note="<why>"
// Raw `items/*.json` and `run.json` are only read. The previous summary.json /
// summary.md are kept as summary.<stamp>.{json,md} before new ones are written.

import fs from 'node:fs'
import path from 'node:path'
import { summarize } from './lib/summary.mjs'

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const dir = path.resolve(arg('dir') ?? '')
const note = arg('note') ?? ''
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

const header = read('run.json')
const previous = read('summary.json')
const items = fs
  .readdirSync(path.join(dir, 'items'))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => read(path.join('items', f)))

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
for (const ext of ['json', 'md']) {
  fs.copyFileSync(path.join(dir, `summary.${ext}`), path.join(dir, `summary.${stamp}.${ext}`))
}

const summary = summarize(items)
const resummarized = { at: new Date().toISOString(), note, previous: `summary.${stamp}.json` }
fs.writeFileSync(
  path.join(dir, 'summary.json'),
  JSON.stringify(
    {
      ...header,
      authCounts: previous.authCounts,
      items: previous.items,
      resummarized,
      summary: summary.table,
    },
    null,
    2,
  ) + '\n',
)
fs.writeFileSync(
  path.join(dir, 'summary.md'),
  `# Paired measurement ${header.label}\n\nBrowser ${header.browser}, Node ${header.node}, fixture src ${header.fixture.sha256}, order ${header.plan.order.join('')}, auth codes consumed ${JSON.stringify(previous.authCounts)}.\nVerdict rule: a difference is claimed only if the B and F ranges do not overlap (≥ 2 samples each).\n\n**Re-aggregated ${resummarized.at}** from the unchanged raw items (no new measurement): ${note} Previous summary: \`${resummarized.previous}\` / \`.md\`.\n\n${summary.markdown}\n`,
)
console.log(
  `resummarized ${items.length} items → ${dir}/summary.{json,md} (previous kept as summary.${stamp}.*)`,
)
