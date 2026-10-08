const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expectedPublishedNames, sha256File } = require('../finalize-release-assets.cjs');
const { ARTIFACT_NAMES, CI_JOBS, RELEASE_JOBS, validateManifest, verifyGates, verifyLocalQualification, stageProducerPayloads, verifyPayloads } = require('../promote-reviewed-0151.cjs');
function candidate() {
  return { schema: 'nirs4all.studio.reviewed-promotion.v2', version: '0.15.1', source_sha: 'a'.repeat(40),
    release_run_id: 100, ci_run_id: 101, local_qualification: { path: 'qualification/local-qualification.json', sha256: 'b'.repeat(64) }, version_run_id: 103,
    artifacts: Object.fromEntries(Object.entries(ARTIFACT_NAMES).map(([key, name], index) => [key, { id: 200 + index, name, digest: `sha256:${'b'.repeat(64)}` }])),
    producer_files: expectedPublishedNames('0.15.1', false, false).flatMap(name => [name, `${name}.sha256`]).map(name => ({ name: name.replace('nirs4all.Studio-', 'nirs4all Studio-'), size: 1, sha256: 'c'.repeat(64) })),
    files: expectedPublishedNames('0.15.1', false, false).flatMap(name => [name, `${name}.sha256`]).map(name => ({ name, size: 1, sha256: 'c'.repeat(64) })),
    docker: { size: 1, sha256: 'd'.repeat(64), image_id: `sha256:${'e'.repeat(64)}` }, notes_sha256: 'f'.repeat(64) };
}
function server(m) {
  const records = {};
  for (const [id, workflow, event, names] of [
    [m.release_run_id, 'release-unified', 'workflow_dispatch', RELEASE_JOBS], [m.ci_run_id, 'ci', 'push', CI_JOBS],
    [m.version_run_id, 'version-guard', 'push', ['version-guard']],
  ]) {
    records[`actions/runs/${id}`] = { id, head_sha: m.source_sha, path: `.github/workflows/${workflow}.yml`, event, head_branch: 'main', status: 'completed', conclusion: 'success' };
    const jobs = names.map(name => ({ name, status: 'completed', conclusion: 'success' }));
    if (id === m.release_run_id) {
      jobs.push({ name: 'Installer — macOS x64', status: 'completed', conclusion: 'skipped' });
      jobs.find(job => job.name === 'Create Release').steps = ['Publish the tested Docker image', 'Publish verified assets sequentially']
        .map(name => ({ name, status: 'completed', conclusion: 'skipped' }));
    }
    records[`actions/runs/${id}/jobs?per_page=100`] = { jobs, total_count: jobs.length };
  }
  records[`actions/runs/${m.release_run_id}/artifacts?per_page=100`] = {
    total_count: 4, artifacts: Object.values(m.artifacts).map(item => ({ ...item, expired: false, workflow_run: { id: m.release_run_id, head_sha: m.source_sha } })) };
  records[`compare/${m.source_sha}...main`] = { status: 'ahead', merge_base_commit: { sha: m.source_sha } };
  return records;
}
test('all exact successful source gates and immutable reviewed artifacts are required', async () => {
  const m = candidate(), records = server(m);
  await verifyGates(m, async endpoint => structuredClone(records[endpoint]));
});
test('failed, skipped, mismatched-source, truncated and already-published candidates fail closed', async () => {
  for (const alter of [
    records => { records['actions/runs/100'].conclusion = 'failure'; },
    records => { records['actions/runs/100'].event = 'push'; },
    records => { records['actions/runs/100'].head_sha = '0'.repeat(40); },
    records => { records['actions/runs/103'].head_sha = '0'.repeat(40); },
    records => { records['actions/runs/101'].head_branch = 'fork'; },
    records => { records['actions/runs/100/jobs?per_page=100'].jobs.find(job => job.name === 'Installer — Windows x64').conclusion = 'skipped'; },
    records => { records['actions/runs/100/jobs?per_page=100'].total_count += 1; },
    records => { records['actions/runs/100/jobs?per_page=100'].jobs.find(job => job.name === 'Create Release').steps[0].conclusion = 'success'; },
    records => { records['actions/runs/100/artifacts?per_page=100'].artifacts[0].expired = true; },
    records => { records['actions/runs/100/artifacts?per_page=100'].artifacts[0].digest = `sha256:${'0'.repeat(64)}`; },
    records => { records['actions/runs/100/artifacts?per_page=100'].artifacts[0].workflow_run.head_sha = '0'.repeat(40); },
    records => { records[`compare/${'a'.repeat(40)}...main`].status = 'diverged'; },
  ]) {
    const m = candidate(), records = server(m); alter(records);
    await assert.rejects(verifyGates(m, async endpoint => structuredClone(records[endpoint])));
  }
});
test('manifest refuses other versions, source aliases, duplicate IDs and arbitrary asset paths', () => {
  for (const alter of [
    m => { m.version = '0.15.2'; }, m => { m.source_sha = 'main'; }, m => { m.extra = true; },
    m => { m.ci_run_id = m.release_run_id; }, m => { m.artifacts.macos.id = m.artifacts.windows.id; },
    m => { m.local_qualification.path = '../unreviewed.json'; }, m => { m.e2e_run_id = 102; },
    m => { m.files[0].name = '../app.exe'; }, m => { m.files[0].size = 0; },
  ]) { const m = candidate(); alter(m); assert.throws(() => validateManifest(m)); }
});
test('payload hashes, sizes, sidecars, Docker tar and release notes must equal review; symlinks refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed0151-test-'));
  try {
    fs.mkdirSync(path.join(root, 'release')); fs.mkdirSync(path.join(root, 'docker'));
    const m = candidate();
    for (const name of expectedPublishedNames('0.15.1', false, false)) {
      const file = path.join(root, 'release', name); fs.writeFileSync(file, `installer ${name}`);
      fs.writeFileSync(`${file}.sha256`, `${sha256File(file)}  ${name}\n`);
    }
    for (const item of m.files) { const file = path.join(root, 'release', item.name); item.size = fs.statSync(file).size; item.sha256 = sha256File(file); }
    const tar = path.join(root, 'docker', 'studio-image.tar'); fs.writeFileSync(tar, 'reviewed Docker bytes');
    m.docker.size = fs.statSync(tar).size; m.docker.sha256 = sha256File(tar);
    const notes = path.join(root, 'notes.md'); fs.writeFileSync(notes, 'Reviewed exact release notes'); m.notes_sha256 = sha256File(notes);
    verifyPayloads(m, root, notes);
    fs.appendFileSync(notes, 'changed'); assert.throws(() => verifyPayloads(m, root, notes)); fs.writeFileSync(notes, 'Reviewed exact release notes');
    fs.appendFileSync(tar, 'changed'); assert.throws(() => verifyPayloads(m, root, notes)); fs.writeFileSync(tar, 'reviewed Docker bytes');
    const file = path.join(root, 'release', m.files[0].name); const saved = fs.readFileSync(file);
    fs.writeFileSync(file, 'changed'); assert.throws(() => verifyPayloads(m, root, notes)); fs.writeFileSync(file, saved);
    fs.unlinkSync(tar); fs.symlinkSync(notes, tar); assert.throws(() => verifyPayloads(m, root, notes), /non-symlink/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real producer space-names normalize without rebuilding; both producer and public hashes bound', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed0151-producers-'));
  try {
    const folders = ['linux', 'windows', 'macos'].map(key => path.join(root, key));
    for (const folder of [...folders, path.join(root, 'release')]) fs.mkdirSync(folder);
    const m = candidate();
    for (const item of m.producer_files.filter(file => !file.name.endsWith('.sha256'))) {
      const folder = folders[item.name.endsWith('.deb') ? 0 : item.name.endsWith('.exe') ? 1 : 2];
      const file = path.join(folder, item.name); fs.writeFileSync(file, `exact reviewed installer ${item.name}`);
      fs.writeFileSync(`${file}.sha256`, `${sha256File(file)}  ${item.name}\n`);
    }
    for (const item of m.producer_files) {
      const file = folders.map(folder => path.join(folder, item.name)).find(file => fs.existsSync(file));
      item.size = fs.statSync(file).size; item.sha256 = sha256File(file);
    }
    stageProducerPayloads(m, root, folders);
    for (const name of expectedPublishedNames('0.15.1', false, false)) {
      const producer = m.producer_files.find(item => item.name === name.replace('nirs4all.Studio-', 'nirs4all Studio-'));
      assert.equal(sha256File(path.join(root, 'release', name)), producer.sha256, 'Installer binary must remain byte-identical');
      assert.equal(fs.readFileSync(path.join(root, 'release', `${name}.sha256`), 'utf8'), `${producer.sha256}  ${name}\n`);
    }
    // A producer mutation is rejected before normalization/publication.
    fs.rmSync(path.join(root, 'release'), { recursive: true }); fs.mkdirSync(path.join(root, 'release'));
    const producer = m.producer_files[0];
    const file = folders.map(folder => path.join(folder, producer.name)).find(file => fs.existsSync(file));
    fs.appendFileSync(file, 'tampered'); assert.throws(() => stageProducerPayloads(m, root, folders));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('reviewed local receipt hash and shared strict verifier are mandatory before promotion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed0151-local-'));
  const previous = process.cwd();
  try {
    fs.mkdirSync(path.join(root, 'qualification'));
    const receipt = path.join(root, 'qualification/local-qualification.json');
    fs.writeFileSync(receipt, '{"strict":"retained evidence, not a production qualification"}');
    const m = candidate(); m.local_qualification.sha256 = sha256File(receipt);
    process.chdir(root);
    const calls = [];
    await verifyLocalQualification(m, async (program, args) => { calls.push([program, args]); });
    assert.deepEqual(calls, [['python3', ['scripts/verify_local_qualification.py', '--project', 'studio', '--receipt', 'qualification/local-qualification.json', '--root', '.']]]);
    await assert.rejects(verifyLocalQualification(m, async () => { throw new Error('stale runtime or missing local gate'); }), /missing local gate/);
    fs.appendFileSync(receipt, 'tampered');
    await assert.rejects(verifyLocalQualification(m, async () => assert.fail('Must not invoke verifier with changed evidence')), /bytes differ/);
  } finally { process.chdir(previous); fs.rmSync(root, { recursive: true, force: true }); }
});
