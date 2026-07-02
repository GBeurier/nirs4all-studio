#!/usr/bin/env node
// SPDX-License-Identifier: CECILL-2.1

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const upstream = resolve(root, '..', 'nirs4all-ui')
const vendor = resolve(root, 'vendor', 'nirs4all-ui')
const check = process.argv.includes('--check')
const required = process.env.NIRS4ALL_UI_SHIM_REQUIRED === '1'
const entries = ['package.json', 'README.md', 'src', 'dist']

if (!existsSync(upstream)) {
  const msg = `nirs4all-ui shim not found at ${upstream}`
  if (required) {
    throw new Error(msg)
  }
  console.warn(`[sync-ui-shim] ${msg}; skipping.`)
  process.exit(0)
}

const sourceFiles = collectFiles(upstream, entries)
const targetFiles = collectFiles(vendor, entries, { ignoreMissingRoot: true })
let drift = sourceFiles.length !== targetFiles.length

for (const rel of sourceFiles) {
  const source = resolve(upstream, rel)
  const target = resolve(vendor, rel)
  if (!existsSync(target)) {
    drift = true
    continue
  }
  const sourceText = readFileSync(source)
  const targetText = readFileSync(target)
  if (Buffer.compare(sourceText, targetText) !== 0) {
    drift = true
  }
}

for (const rel of targetFiles) {
  if (!sourceFiles.includes(rel)) {
    drift = true
  }
}

if (check) {
  if (drift) {
    console.error('[sync-ui-shim] drift detected; run `npm run vendor:ui` from the repo root.')
    process.exit(1)
  }
  console.log('[sync-ui-shim] vendor/nirs4all-ui is up to date.')
  process.exit(0)
}

if (!drift) {
  console.log('[sync-ui-shim] vendor/nirs4all-ui is up to date.')
  process.exit(0)
}

rmSync(vendor, { recursive: true, force: true })
mkdirSync(vendor, { recursive: true })
for (const entry of entries) {
  const source = resolve(upstream, entry)
  const target = resolve(vendor, entry)
  cpSync(source, target, { recursive: true })
  console.log(`[sync-ui-shim] updated ${relative(root, target)}`)
}

function collectFiles(base, items, options = {}) {
  if (!existsSync(base)) {
    if (options.ignoreMissingRoot) return []
    throw new Error(`missing directory: ${base}`)
  }
  return items.flatMap((item) => walk(resolve(base, item), item, options)).sort()
}

function walk(absPath, relPath, options) {
  if (!existsSync(absPath)) {
    if (options.ignoreMissingRoot) return []
    throw new Error(`missing source shim entry: ${absPath}`)
  }
  const stat = lstatSync(absPath)
  if (stat.isDirectory()) {
    return readdirSync(absPath, { withFileTypes: true }).flatMap((entry) =>
      walk(resolve(absPath, entry.name), `${relPath}/${entry.name}`, options),
    )
  }
  return [relPath]
}
