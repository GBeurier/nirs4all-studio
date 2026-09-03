import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_DIST_FILES = ['index.js', 'n4m.js', 'n4m.wasm'];

export function resolveMethodsArtifact() {
  const override = process.env.NIRS4ALL_METHODS_JS_DIST;
  const root = process.env.NIRS4ALL_METHODS_ROOT;
  const indexUrl = override
    ? methodsIndexUrl(override)
    : root
      ? methodsIndexUrl(join(root, 'bindings/js/dist'))
      : new URL('../../../../nirs4all-methods/bindings/js/dist/index.js', import.meta.url);
  const indexPath = fileURLToPath(indexUrl);
  const distPath = dirname(indexPath);
  const missing = REQUIRED_DIST_FILES.filter((name) => !existsSync(join(distPath, name)));

  return {
    distPath,
    indexPath,
    indexUrl,
    missing,
    source: override ? 'NIRS4ALL_METHODS_JS_DIST' : root ? 'NIRS4ALL_METHODS_ROOT' : 'default sibling nirs4all-methods',
  };
}

export function requireMethodsArtifact(t) {
  const artifact = resolveMethodsArtifact();
  if (artifact.missing.length === 0) {
    return artifact;
  }

  const message = missingMethodsArtifactMessage(artifact);
  if (strictMethodsParity()) {
    throw new Error(message);
  }
  t.skip(message);
  return null;
}

function strictMethodsParity() {
  return process.env.NIRS4ALL_CORE_REQUIRE_METHODS_PARITY === '1';
}

function methodsIndexUrl(pathOrFile) {
  const target = resolve(pathOrFile);
  return pathToFileURL(target.endsWith('.js') ? target : join(target, 'index.js'));
}

function missingMethodsArtifactMessage(artifact) {
  return [
    `local nirs4all-methods JS/WASM build is not available (${artifact.source}: ${artifact.distPath}; missing ${artifact.missing.join(', ')})`,
    'build/stage it in the Methods checkout with: cmake --preset emscripten && cmake --build --preset emscripten --target n4m_wasm --parallel && cd bindings/js && npm ci && npm run build && npm run stage:wasm',
    'then rerun with NIRS4ALL_METHODS_JS_DIST=/path/to/nirs4all-methods/bindings/js/dist and NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1',
  ].join('; ');
}
