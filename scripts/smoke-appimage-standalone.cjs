/** Launch the original AppImage through FUSE and exercise its bundled runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:net');
const { spawn } = require('node:child_process');

function processTable(io = fs) {
  return io.readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
    try {
      const stat = io.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return [{ pid: Number(name), parent: Number(fields[1]), group: Number(fields[2]), state: fields[0] }];
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return [];
      throw error;
    }
  });
}

function decodeMountPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function attributedFuseProcesses(childPid, appimage, io = fs) {
  const table = processTable(io);
  const descendants = new Set([childPid]);
  let changed;
  do {
    changed = false;
    for (const entry of table) {
      if (descendants.has(entry.parent) && !descendants.has(entry.pid)) {
        descendants.add(entry.pid); changed = true;
      }
    }
  } while (changed);
  const source = io.realpathSync(appimage);
  const matches = [];
  for (const pid of descendants) {
    try {
      const env = Object.fromEntries(io.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
        .filter(item => item.includes('=')).map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
      if (!env.APPIMAGE || !env.APPDIR || io.realpathSync(env.APPIMAGE) !== source) continue;
      if (!path.isAbsolute(env.APPDIR)) continue;
      const appDir = path.normalize(env.APPDIR);
      const executable = io.readlinkSync(`/proc/${pid}/exe`);
      if (!executable.startsWith(`${appDir}${path.sep}`)) continue;
      const mounts = io.readFileSync(`/proc/${pid}/mountinfo`, 'utf8').split('\n').filter(line => {
        const [location, filesystem] = line.split(' - ');
        return filesystem && /^fuse(?:\.| )/.test(filesystem)
          && decodeMountPath(location.split(' ')[4]) === appDir;
      });
      if (mounts.length) matches.push({ pid, appimage: source, app_dir: appDir, executable, fuse_mounts: mounts });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
      throw error;
    }
  }
  assert(matches.length > 0, 'No live descendant executable belongs to a FUSE mount of the exact AppImage');
  return matches;
}

async function stopAppImage(child, options = {}) {
  if (!child.pid) return;
  const table = options.processTable || processTable;
  const kill = options.kill || process.kill.bind(process);
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const stopped = () => (child.exitCode !== null || child.signalCode !== null)
    && !table().some(entry => entry.group === child.pid && entry.state !== 'Z' && entry.state !== 'X');
  const signal = name => {
    try { kill(-child.pid, name); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const wait = async timeout => {
    const deadline = Date.now() + timeout;
    while (!stopped()) {
      if (Date.now() >= deadline) return false;
      await delay(50);
    }
    return true;
  };
  if (stopped()) return;
  signal('SIGTERM');
  if (await wait(options.terminateTimeoutMs ?? 15000)) return;
  signal('SIGKILL');
  assert(await wait(options.killTimeoutMs ?? 5000), 'AppImage process group did not stop after SIGKILL');
}

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
  // Exercise the AppImage loader and FUSE, without extraction fallback.
  delete env.APPIMAGE_EXTRACT_AND_RUN;
  delete env.APPIMAGE;
  delete env.APPDIR;
  assert.equal(env.NIRS4ALL_OFFLINE, '1', 'AppImage scientific checks must run in offline mode');
  const output = [];
  let spawnError;
  const child = spawn(appimage, [], { env, cwd: path.dirname(appimage), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => { spawnError = error; output.push(error.message); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    output.push(bytes.toString()); if (output.length > 100) output.shift();
  });
  let proof;
  try {
    await archive.waitForNativeScientificReady(port, timeout, child, output, env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN);
    if (spawnError) throw spawnError;
    const mountedProcesses = attributedFuseProcesses(child.pid, appimage);
    await archive.verifyInstalledProduct(port, env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN);
    proof = { success: true, version: '0.11.5', appimage_sha256: digest, actual_fuse_launch: true,
      mounted_processes: mountedProcesses, scientific_readiness: true, installed_product_probe: true,
      offline_mode: env.NIRS4ALL_OFFLINE === '1', process_group_stopped: true };
  } finally {
    try { await stopAppImage(child); }
    finally { fs.writeFileSync(path.join(root, 'application.log'), output.join('\n')); }
  }
  // A result is successful only after both qualification and confirmed shutdown.
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(proof, null, 2));
  console.log(`Actual AppImage FUSE launch and offline scientific product checks passed: ${digest}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { attributedFuseProcesses, decodeMountPath, processTable, stopAppImage, main };
