/** Disposable desktop runner: real N-1 -> N archives, no rebuild. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createServer } = require('node:net');
const http = require('node:http');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repo = path.resolve(process.argv[2] || process.cwd());
const from = process.argv[3] || '0.11.4';
const to = process.argv[4] || '0.11.5';
const candidate = process.argv[5] ? path.resolve(process.argv[5]) : null;
const oldLocal = process.argv[6] ? path.resolve(process.argv[6]) : null;
const platform = process.platform;
function platformArchiveSuffix(targetPlatform, targetArch) {
  const suffixes = { 'win32:x64': 'win-x64.zip', 'linux:x64': 'linux-x64.tar.gz', 'darwin:arm64': 'mac-arm64.zip', 'darwin:x64': 'mac-x64.zip' };
  const suffix = suffixes[`${targetPlatform}:${targetArch}`];
  assert(suffix, `Unsupported real-update platform: ${targetPlatform}/${targetArch}`);
  return suffix;
}
function extractOldArchive(targetPlatform, downloaded, extracted, execute = execFileSync) {
  // ditto preserves framework symlinks and resource forks in signed app bundles.
  const command = targetPlatform === 'darwin' ? 'ditto' : targetPlatform === 'win32' ? 'tar.exe' : 'tar';
  const args = targetPlatform === 'darwin' ? ['-x', '-k', downloaded, extracted] : ['-xf', downloaded, '-C', extracted];
  execute(command, args, { stdio: 'inherit' });
}
const timeout = 360000;
const project = 'GBeurier/nirs4all-studio';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = [];
let root, child, relaunchPid, env, fixture;
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function fixtureServer(file, name, version) {
  const hash = await sha256(file);
  const size = fs.statSync(file).size;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '').split('?')[0]);
    const base = `http://127.0.0.1:${server.address().port}`;
    if (url.endsWith('/releases/latest')) {
      const release = { tag_name: version, prerelease: false, draft: false, html_url: `${base}/releases/tag/${version}`, body: 'Exact qualified candidate archive', assets: [
        { name, size, browser_download_url: `${base}/${encodeURIComponent(name)}` },
        { name: `${name}.sha256`, size: 128, browser_download_url: `${base}/${encodeURIComponent(name)}.sha256` },
      ] };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(release));
    } else if (url === `/${name}.sha256`) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(`${hash}  ${name}\n`);
    } else if (url === `/${name}`) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); res.on('close', () => stream.destroy());
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { base: `http://127.0.0.1:${server.address().port}`, hash, close: () => { server.closeAllConnections(); server.close(); } };
}
function gracefulStop(pid, updater) {
  if (platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', updater.windowsGracefulCloseScript(pid)], { stdio: 'pipe' });
  else process.kill(pid, 'SIGTERM');
}
function processStillRunning(pid) {
  try {
    process.kill(pid, 0);
    if (platform === 'linux') {
      // Detached helper children can remain zombies until their parent reaps
      // them. They have exited and hold no resources despite kill(pid, 0).
      const status = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (status.slice(status.lastIndexOf(')') + 2, status.lastIndexOf(')') + 3) === 'Z') return false;
    }
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
    throw error;
  }
}
function capture(chunk) {
  output.push(chunk.toString());
  if (output.length > 100) output.shift();
}
async function json(url, token) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'studio-real-release-update-check', ...(token ? { 'X-Nirs4all-Session': token } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
async function poll(check, label, ms = timeout) {
  const deadline = Date.now() + ms;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await delay(1000);
  }
  throw new Error(`${label}: ${lastError?.message || 'timed out'}`);
}
function forceStop(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  try { if (platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL'); } catch {}
}
async function main() {
  const platformSuffix = platformArchiveSuffix(platform, process.arch);
  assert.match(from, /^\d+\.\d+\.\d+$/);
  assert.match(to, /^\d+\.\d+\.\d+$/);
  const archive = require(path.join(repo, 'scripts/smoke-archive-standalone.cjs'));
  const updater = require(path.join(repo, 'scripts/smoke-self-update.cjs'));
  root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'studio-real-update-'));
  console.log(`Disposable test directory: ${root}`);
  const targetName = `nirs4all.Studio-${to}-all-in-one-${platformSuffix}`;
  if (candidate) {
    assert(fs.statSync(candidate).isFile(), 'Candidate archive must exist');
    const sidecar = fs.readFileSync(`${candidate}.sha256`, 'utf8').trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    assert(sidecar && sidecar[2] === path.basename(candidate), 'Candidate checksum must bind exact filename');
    assert.equal(await sha256(candidate), sidecar[1].toLowerCase(), 'Candidate archive SHA mismatch');
    fixture = await fixtureServer(candidate, targetName, to);
  } else {
    const latest = await json(`https://api.github.com/repos/${project}/releases/latest`);
    assert.equal(latest.tag_name.replace(/^v/, ''), to, 'Public latest must be target version');
    assert.equal(latest.draft, false);
    assert.equal(latest.prerelease, false);
    assert(latest.assets.some(asset => asset.name === targetName && asset.size > 0));
    assert(latest.assets.some(asset => asset.name === `${targetName}.sha256` && asset.size > 0));
  }
  const old = await json(`https://api.github.com/repos/${project}/releases/tags/${from}`);
  const oldName = `nirs4all.Studio-${from}-all-in-one-${platformSuffix}`;
  const oldAsset = old.assets.find(asset => asset.name === oldName);
  const checksum = old.assets.find(asset => asset.name === `${oldName}.sha256`);
  assert(oldAsset && checksum, 'Old platform release archive and checksum must exist');
  const checksumResponse = await fetch(checksum.browser_download_url, { signal: AbortSignal.timeout(30000) });
  assert(checksumResponse.ok, `Old checksum HTTP ${checksumResponse.status}`);
  const record = (await checksumResponse.text()).trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  assert(record && record[2] === oldName, 'Old checksum must bind exactly the archive name');
  const downloaded = oldLocal || path.join(root, oldName);
  if (!oldLocal) {
  const response = await fetch(oldAsset.browser_download_url, { signal: AbortSignal.timeout(timeout) });
  assert(response.ok && response.body, `Old archive HTTP ${response.status}`);
  const hasher = crypto.createHash('sha256');
  let size = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, done) { size += chunk.length; hasher.update(chunk); done(null, chunk); },
  }), fs.createWriteStream(downloaded, { flags: 'wx' }));
  assert.equal(size, oldAsset.size);
  assert.equal(hasher.digest('hex'), record[1].toLowerCase(), 'Downloaded old archive SHA mismatch');
  } else {
    assert.equal(fs.statSync(downloaded).size, oldAsset.size);
    assert.equal(await sha256(downloaded), record[1].toLowerCase(), 'Local old public archive SHA mismatch');
  }
  const extracted = path.join(root, 'installed');
  fs.mkdirSync(extracted);
  extractOldArchive(platform, downloaded, extracted);
  const layout = archive.resolveLaunchLayout(extracted, platform, 'nirs4all Studio');
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  env = archive.buildSandboxEnv(platform, path.join(root, 'profile'), port, timeout);
  delete env.NIRS4ALL_OFFLINE;
  delete env.NIRS4ALL_UPDATE_API_BASE;
  if (fixture) env.NIRS4ALL_UPDATE_API_BASE = fixture.base;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  env.SENTRY_DSN = '';
  const token = env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  const base = `http://127.0.0.1:${port}`;
  child = spawn(layout.executablePath, [], { cwd: layout.appRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', error => capture(error.message));
  await poll(async () => {
    assert.equal(child.exitCode, null, 'Old app exited before readiness');
    const health = await json(`${base}/api/health`, token);
    return health.ready || health.core_ready;
  }, 'Old app health');
  const before = await json(`${base}/api/updates/webapp/download-info`, token);
  assert.equal(before.current_version, from);
  assert.equal(before.latest_version, to);
  assert.equal(before.asset_name, targetName);
  assert.equal(before.can_apply_in_place, true);
  assert.equal(before.update_available, true);
  const stale = path.join(layout.appRoot, 'REAL_MIGRATION_STALE');
  fs.writeFileSync(stale, 'Must disappear after full application replacement');
  console.log(`Real public update: ${from} -> ${to}, asset ${before.asset_name}`);
  await updater.driveUpdate(base, timeout, () => output.join('\n'), token);
  gracefulStop(child.pid, updater);
  assert(await archive.waitForChildExit(child, 15000), 'Old Electron must quit gracefully for the update');
  child = null;
  await archive.waitForNativeScientificReady(port, timeout, { exitCode: null }, output, token);
  const result = await poll(async () => {
    const value = await json(`${base}/api/updates/webapp/last-apply-result`, token);
    if (Number.isInteger(value.relaunch_pid)) relaunchPid = value.relaunch_pid;
    return value.status === 'success' && relaunchPid > 0 ? value : false;
  }, 'Updater reconciliation');
  assert.equal(result.from_version, from);
  assert.equal(result.to_version, to);
  assert.equal(result.current_version, to);
  assert.equal(fs.existsSync(stale), false, 'Update left stale old application files');
  const after = await json(`${base}/api/updates/webapp/download-info`, token);
  assert.equal(after.current_version, to);
  assert.equal(after.update_available, false);
  await archive.verifyInstalledProduct(port, token);
  gracefulStop(relaunchPid, updater);
  await poll(async () => {
    if (processStillRunning(relaunchPid)) return false;
    // Also require the old sidecar listener to be gone before cold boot.
    try {
      await fetch(`${base}/api/health`, {
        headers: { 'X-Nirs4all-Session': token }, signal: AbortSignal.timeout(1500),
      });
      return false;
    } catch { /* No reachable health endpoint after process exit. */ }
    return true;
  }, 'Updated app graceful quit', 20000);
  relaunchPid = null;
  // The updater retains a sibling backup, so the extraction parent no longer
  // contains only one app directory. Probe the exact application it replaced.
  await archive.smokeArchiveStandalone(archive.parseArgs(['--extracted-root', layout.appRoot, '--platform', platform, '--timeout-ms', String(timeout)]));
  const report = { success: true, from, to, source: candidate ? 'qualified-candidate-fixture' : 'public-latest', target_archive_sha256: fixture?.hash, old_archive_sha256: record[1].toLowerCase(), target_asset: targetName, apply_result: result, offline_cold_boot: true };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
module.exports = { platformArchiveSuffix, extractOldArchive };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  forceStop(child?.pid);
  forceStop(relaunchPid);
  fixture?.close();
  if (root) fs.writeFileSync(path.join(root, 'application.log'), output.join('\n'));
});
