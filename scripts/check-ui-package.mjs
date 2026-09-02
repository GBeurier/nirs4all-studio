#!/usr/bin/env node
// SPDX-License-Identifier: CECILL-2.1

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const packageName = 'nirs4all-ui'
const version = '0.1.13'
const filename = `${packageName}-${version}.tgz`
const tarballPath = resolve(root, 'vendor', 'npm', filename)
const receiptPath = resolve(root, 'vendor', 'npm', `${packageName}-${version}.provenance.json`)
const legacyShimPath = resolve(root, 'vendor', packageName)
const expectedSha256 = '44ba22aef663548f426518ada8478a5c461e96dd5592cf2691b68776c42b9a67'
const expectedIntegrity = 'sha512-ax4/r2DEjKIRUS3T9yB5Zl5xqc47dL+NSddleKEklofoueRWkkuKZhZlY2tkCU4N1yWRifM3ZkMbWkBUUhmKyw=='

function fail(message) {
  throw new Error(`[check-ui-package] ${message}`)
}

function hash(algorithm, bytes, encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding)
}

function tarEntries(bytes) {
  const archive = gunzipSync(bytes)
  const entries = new Map()
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const readString = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '')
    const name = readString(0, 100)
    const prefix = readString(345, 500)
    const path = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(readString(124, 136).trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0) fail(`invalid tar entry size for ${path}`)
    const bodyStart = offset + 512
    if (header[156] === 0 || header[156] === 48) {
      entries.set(path, archive.subarray(bodyStart, bodyStart + size))
    }
    offset = bodyStart + Math.ceil(size / 512) * 512
  }
  return entries
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets)
  return []
}

if (existsSync(legacyShimPath)) fail('legacy vendor/nirs4all-ui source shim must not exist')
if (!existsSync(tarballPath) || !existsSync(receiptPath)) fail('vendored tarball or provenance receipt is missing')

const bytes = readFileSync(tarballPath)
const sha256 = hash('sha256', bytes)
const integrity = `sha512-${hash('sha512', bytes, 'base64')}`
if (sha256 !== expectedSha256) fail(`SHA-256 mismatch: ${sha256}`)
if (integrity !== expectedIntegrity) fail(`npm integrity mismatch: ${integrity}`)

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
if (receipt.package?.name !== packageName || receipt.package?.version !== version) fail('receipt package identity mismatch')
if (receipt.source?.commit_sha !== '406d94d70004f27459ef12347af1e6f0079ab6ac') fail('receipt source commit mismatch')
if (receipt.source?.tree_sha !== '377722160bbf188c474aacfecc8a6825095be2ca') fail('receipt source tree mismatch')
if (receipt.artifact?.filename !== filename || receipt.artifact?.size !== bytes.length) fail('receipt artifact identity mismatch')
if (receipt.artifact?.sha256 !== sha256 || receipt.artifact?.npm_integrity !== integrity) fail('receipt digest mismatch')

const entries = tarEntries(bytes)
const packagedJson = entries.get('package/package.json')
if (!packagedJson) fail('tarball package.json is missing')
const packaged = JSON.parse(packagedJson.toString('utf8'))
if (packaged.name !== packageName || packaged.version !== version) fail('tarball package identity mismatch')

for (const target of exportTargets(packaged.exports)) {
  const relativeTarget = target.replace(/^\.\//, '')
  if (relativeTarget.includes('*')) {
    const prefix = `package/${relativeTarget.slice(0, relativeTarget.indexOf('*'))}`
    if (![...entries.keys()].some((path) => path.startsWith(prefix))) fail(`empty wildcard export: ${target}`)
  } else if (!entries.has(`package/${relativeTarget}`)) {
    fail(`missing exported package file: ${target}`)
  }
}

for (const licenseFile of receipt.license_files ?? []) {
  if (!entries.has(`package/${licenseFile}`)) fail(`missing license or notice: ${licenseFile}`)
}

const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const dependency = `file:./vendor/npm/${filename}`
if (rootPackage.dependencies?.[packageName] !== dependency) fail('package.json does not select the exact vendored tarball')
if (lock.packages?.['']?.dependencies?.[packageName] !== dependency) fail('package-lock root dependency differs')
const locked = lock.packages?.[`node_modules/${packageName}`]
if (locked?.version !== version || locked?.integrity !== integrity || !locked?.resolved?.endsWith(`vendor/npm/${filename}`)) {
  fail('package-lock does not pin the vendored UI version, path, and integrity')
}

console.log(`[check-ui-package] ${packageName}@${version} verified (${sha256})`)
