#!/usr/bin/env node
// Prepare one compat profile (e2e/compat/matrix.json) for e2e/compat/smoke.mjs.
// Workspace profiles need nothing beyond `pnpm install` + the plugin build.
// Out-of-workspace profiles get the plugin as a packed tarball (what users
// install) and their own install; third-party versions come from the
// fixture's exact pins and lockfile. Assumes the plugin and client are built.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const id = process.argv[2]
const { profiles } = JSON.parse(fs.readFileSync(path.join(root, 'e2e/compat/matrix.json'), 'utf8'))
const profile = profiles.find(p => p.id === id)
if (!profile) {
  console.error(`unknown profile "${id}" (known: ${profiles.map(p => p.id).join(', ')})`)
  process.exit(2)
}

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

if (!profile.workspace) {
  const packDir = path.join(root, 'e2e/compat/.pack')
  fs.rmSync(packDir, { recursive: true, force: true })
  fs.mkdirSync(packDir, { recursive: true })
  run(
    'pnpm',
    ['pack', '--pack-destination', packDir],
    path.join(root, 'packages/vite-devtools-svelte'),
  )
  const [tarball] = fs.readdirSync(packDir).filter(f => f.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack produced no tarball')
  fs.renameSync(path.join(packDir, tarball), path.join(packDir, 'vite-devtools-svelte.tgz'))
  // The tarball's integrity changes with every build, so the lockfile entry
  // for the plugin is refreshed; everything else stays at the locked versions.
  run(
    'pnpm',
    ['install', '--ignore-workspace', '--no-frozen-lockfile'],
    path.join(root, profile.dir),
  )
}

// Fail early when the installed versions drift from the matrix.
for (const [name, want] of Object.entries(profile.versions)) {
  const pkgJson = path.join(root, profile.dir, 'node_modules', name, 'package.json')
  const got = fs.existsSync(pkgJson)
    ? JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version
    : '(missing)'
  if (got !== want) {
    console.error(`${id}: ${name} is ${got}, matrix says ${want}`)
    process.exit(1)
  }
}
console.log(
  `${id}: prepared (${Object.entries(profile.versions)
    .map(([n, v]) => `${n}@${v}`)
    .join(', ')})`,
)
