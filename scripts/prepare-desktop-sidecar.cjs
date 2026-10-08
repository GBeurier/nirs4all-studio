/** Keep desktop development on the current Rust backend, including Rust edits. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function prepareDesktopSidecar(projectRoot, environment = process.env, run = spawnSync) {
  const explicit = environment.NIRS4ALL_NATIVE_SIDECAR_PATH?.trim();
  if (explicit) {
    const binary = path.resolve(projectRoot, explicit);
    if (!fs.statSync(binary).isFile()) throw new Error(`Invalid sidecar binary: ${binary}`);
    return binary;
  }
  const manifest = path.join(projectRoot, 'sidecar', 'Cargo.toml');
  console.log('Building the Rust desktop backend (incremental release build)...');
  const built = run('cargo', ['build', '--locked', '--release', '--manifest-path', manifest, '--bin', 'studio-sidecar'], {
    cwd: projectRoot, env: environment, stdio: 'inherit',
  });
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error(`Rust desktop build failed (exit ${built.status})`);
  const metadata = run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], {
    cwd: projectRoot, env: environment, encoding: 'utf8',
  });
  if (metadata.error) throw metadata.error;
  if (metadata.status !== 0) throw new Error('Cannot locate the built Rust backend');
  const target = JSON.parse(metadata.stdout).target_directory;
  const binary = path.join(target, ...(environment.CARGO_BUILD_TARGET ? [environment.CARGO_BUILD_TARGET] : []),
    'release', process.platform === 'win32' ? 'studio-sidecar.exe' : 'studio-sidecar');
  if (!fs.statSync(binary).isFile()) throw new Error(`Missing built sidecar: ${binary}`);
  return binary;
}

module.exports = { prepareDesktopSidecar };
