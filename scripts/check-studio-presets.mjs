// Studio owns the defaults; every shared snapshot must match its authored YAML.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { STUDIO_PRESET_SOURCE } from 'nirs4all-ui/pipelines'

const directory = new URL('../api/presets/', import.meta.url)
const expected = STUDIO_PRESET_SOURCE.files_sha256
const actual = readdirSync(directory).filter((name) => name.endsWith('.yaml')).sort()
if (JSON.stringify(actual) !== JSON.stringify(Object.keys(expected).sort())) {
  throw new Error('Studio preset files differ from the shared catalogue; regenerate nirs4all-ui presets.')
}
for (const name of actual) {
  const digest = createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex')
  if (digest !== expected[name]) throw new Error(`Studio preset ${name} differs from the shared catalogue; regenerate nirs4all-ui presets.`)
}
console.log(`[check-studio-presets] ${actual.length} Studio defaults match the shared Web/Repository catalogue`)
