/** Launch the original AppImage through FUSE and exercise its bundled runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:net');
const { spawn } = require('node:child_process');

async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  assert(fs.existsSync('/dev/fuse'), 'Actual AppImage qualification requires /dev/fuse');
  const repo = path.resolve(process.argv[2]);
  const appimage = path.resolve(process.argv[3]);
  assert.equal(path.basename(appimage), 'nirs4all Studio-0.11.5-linux-x86_64.AppImage');
  const archive = require(path.join(repo, 'scripts/smoke-archive-standalone.cjs'));
  const { parseChecksumSidecar, sha256File } = require(path.join(repo, 'scripts/finalize-release-assets.cjs'));
  const digest = sha256File(appimage);
  assert.equal(digest, parseChecksumSidecar(`${appimage}.sha256`, path.basename(appimage)));
  const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'studio-appimage-'));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const timeout = 360000;
  const env = archive.buildSandboxEnv('linux', path.join(root, 'profile'), port, timeout);
  // The proof must exercise the AppImage loader and FUSE, not extraction fallback.
  delete env.APPIMAGE_EXTRACT_AND_RUN;
  delete env.APPIMAGE;
  delete env.APPDIR;
  const output = [];
  let spawnError;
  const child = spawn(appimage, [], { env, cwd: path.dirname(appimage), stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => { spawnError = error; output.push(error.message); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    output.push(bytes.toString()); if (output.length > 100) output.shift();
  });
  try {
    await archive.waitForNativeScientificReady(port, timeout, child, output, env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN);
    if (spawnError) throw spawnError;
    const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').filter(line => line.includes('.mount_') && / - fuse[. ]/.test(line));
    assert(mounts.length > 0, 'AppImage must be mounted with FUSE during scientific qualification');
    await archive.verifyInstalledProduct(port, env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN);
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ success: true, version: '0.11.5', appimage_sha256: digest, actual_fuse_launch: true, fuse_mounts: mounts, scientific_readiness: true, installed_product_probe: true }, null, 2));
    console.log(`Actual AppImage FUSE launch and offline scientific product checks passed: ${digest}`);
  } finally {
    if (child.pid && child.exitCode === null) {
      child.kill('SIGTERM');
      if (!await archive.waitForChildExit(child, 15000)) { child.kill('SIGKILL'); await archive.waitForChildExit(child, 5000); }
    }
    fs.writeFileSync(path.join(root, 'application.log'), output.join('\n'));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
