/**
 * Profile isolation for the packaged-application smokes: the application's
 * configuration, data and logs are pinned inside a directory that the smoke
 * owns, and the workspace is created there through the real sidecar before
 * Electron starts, so a smoke never touches the user's own workspace.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const archive = require('./smoke-archive-standalone.cjs');

function ordinaryPath(file) {
  if (process.platform !== 'win32') return file;
  assert(!file.startsWith('\\\\.\\'), 'Device paths are not smoke profile paths');
  if (!file.startsWith('\\\\?\\')) return file;
  const dos = /^\\\\\?\\([A-Za-z]:\\.*)$/.exec(file);
  if (dos) return dos[1];
  const unc = /^\\\\\?\\UNC\\([^\\]+)\\([^\\]+)(\\.*)?$/i.exec(file);
  assert(unc, 'Unsupported Windows namespace in smoke profile path');
  return `\\\\${unc[1]}\\${unc[2]}${unc[3] || '\\'}`;
}
function filesystemPath(file) {
  const ordinary = ordinaryPath(file);
  if (ordinary === file) return file;
  const resolved = path.resolve(ordinary);
  // Node cannot lstat an extended drive root. Keep extended member paths,
  // including long paths, but use the ordinary spelling for a root itself.
  return path.dirname(resolved) === resolved ? resolved : path.toNamespacedPath(resolved);
}
function canonicalPath(file) {
  // The JS realpath implementation itself walks extended drive roots and
  // fails on Windows. The native OS call resolves junctions and long paths.
  return ordinaryPath(process.platform === 'win32'
    ? fs.realpathSync.native(filesystemPath(file)) : fs.realpathSync(file));
}
function contained(parent, file) {
  const relative = path.relative(canonicalPath(parent), canonicalPath(file));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path escapes owned root: ${file}`);
}
function plainAncestors(file) {
  const ordinary = ordinaryPath(file), namespaced = ordinary !== file;
  let current = path.resolve(ordinary);
  while (true) {
    const parent = path.dirname(current);
    const member = namespaced && parent !== current ? path.toNamespacedPath(current) : current;
    assert(!fs.lstatSync(member).isSymbolicLink(), `Link in smoke profile path: ${current}`);
    if (parent === current) break; current = parent;
  }
}
async function withOwnedProfile(profile, action) {
  const values = { NIRS4ALL_CONFIG: path.join(profile, 'config'), NIRS4ALL_BACKEND_DATA_DIR: path.join(profile, 'backend-data'),
    NIRS4ALL_BACKEND_LOG_DIR: path.join(profile, 'backend-logs'),
    PORTABLE_EXECUTABLE_FILE: undefined, NIRS4ALL_PORTABLE_ROOT: undefined };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  plainAncestors(profile);
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) { delete process.env[key]; continue; }
      if (fs.existsSync(value)) plainAncestors(value);
      fs.mkdirSync(value, { recursive: true }); process.env[key] = value;
    }
    return await action();
  }
  finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
async function localApi(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
  assert(response.ok, `Owned workspace ${route}: HTTP ${response.status}`);
  return response.json();
}
async function assertOwnedWorkspace(env, ownedRoot) {
  const active = (await localApi(env, '/workspace')).workspace?.path;
  assert(active, 'No actual active workspace'); plainAncestors(active); contained(ownedRoot, active);
  return active;
}
async function bootstrapOwnedWorkspace(layout, profile, ownedRoot) {
  // Electron's default Documents path is an OS known folder. Bootstrap the
  // real catalogue before Electron starts, so it never creates a real-user workspace.
  contained(ownedRoot, profile); plainAncestors(profile);
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = archive.buildSandboxEnv(process.platform, profile, port, 120000);
  for (const key of ['NIRS4ALL_CONFIG', 'NIRS4ALL_BACKEND_DATA_DIR', 'NIRS4ALL_BACKEND_LOG_DIR']) {
    assert(env[key], `Missing owned ${key}`); plainAncestors(env[key]); contained(profile, env[key]);
  }
  env.NIRS4ALL_STUDIO_SESSION_TOKEN = env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  delete env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  const requestEnv = { ...env, NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: env.NIRS4ALL_STUDIO_SESSION_TOKEN };
  const logPath = path.join(profile, 'workspace-bootstrap.log'), log = fs.openSync(logPath, 'wx');
  try {
    const child = spawn(layout.nativeSidecarPath, ['--host', '127.0.0.1', '--port', String(port)], {
      cwd: layout.appRoot, env, stdio: ['ignore', log, log], windowsHide: true });
    let exit, processError;
    const terminal = new Promise(resolve => child.once('close', (code, signal) => { exit = { code, signal }; resolve(); }));
    child.once('error', error => { processError = error; });
    try {
      const deadline = Date.now() + 120000; let ready = false;
      while (Date.now() < deadline) {
        if (processError) throw processError;
        assert(!exit, 'Workspace bootstrap sidecar exited before readiness');
        try { await localApi(requestEnv, '/health'); ready = true; break; } catch { /* bounded startup poll */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(ready, 'Workspace bootstrap sidecar did not become ready');
      const workspace = path.join(profile, 'startup-workspace');
      await localApi(requestEnv, '/workspace/create', 'POST', { path: workspace, name: 'Isolated packaged smoke', create_dir: true });
      await localApi(requestEnv, '/workspace/select', 'POST', { path: workspace });
      await assertOwnedWorkspace(requestEnv, ownedRoot);
    } finally {
      if (!exit) child.kill('SIGTERM');
      let timer;
      const stopped = await Promise.race([terminal.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      if (!stopped) {
        child.kill('SIGKILL');
        const killed = await Promise.race([terminal.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
        clearTimeout(timer); assert(killed, 'Owned bootstrap sidecar could not be stopped; do not continue');
      }
    }
  } finally { fs.closeSync(log); }
}

module.exports = { contained, canonicalPath, plainAncestors, withOwnedProfile, bootstrapOwnedWorkspace, assertOwnedWorkspace };
