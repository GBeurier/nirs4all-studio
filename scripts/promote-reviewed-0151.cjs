/** Promote only the exact reviewed 0.15.1 dry artifacts; never rebuild. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { expectedPublishedNames, sha256File, finalizeReleaseAssets } = require('./finalize-release-assets.cjs');
const { publishQualifiedRelease, releaseManifest } = require('./publish-qualified-release.cjs');
const execFileAsync = promisify(execFile);
const REPO = 'GBeurier/nirs4all-studio';
const VERSION = '0.15.1';
const MANIFEST = 'build/release/studio-0.15.1-reviewed.json';
const NOTES = 'build/release/studio-0.15.1-reviewed-notes.md';
const ARTIFACT_NAMES = Object.freeze({ linux: 'installer-linux-x64-payload', windows: 'installer-windows-x64-payload',
  macos: 'installer-macos-arm64-payload', docker: 'docker-candidate' });
const CI_JOBS = ['Backend', 'Frontend', 'Native Sidecar Windows Containment', 'Native Docker Runtime', 'Electron Build Test', 'CI Summary'];
const RELEASE_JOBS = ['Prepare', 'Acquire pinned plugin wheels', 'Native Docker Image',
  ...CI_JOBS.map(name => `Qualify release commit / ${name}`),
  'Installer — Linux x64', 'Installer — Windows x64', 'Installer — macOS arm64', 'Create Release'];
function closed(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has missing/extra fields`);
}
function positive(value, label) { assert(Number.isSafeInteger(value) && value > 0, `Invalid ${label}`); }
function digest(value, label) { assert(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), `Invalid ${label}`); }
function validateManifest(value) {
  closed(value, ['schema', 'version', 'source_sha', 'release_run_id', 'ci_run_id', 'local_qualification', 'version_run_id',
    'artifacts', 'producer_files', 'files', 'docker', 'notes_sha256'], 'Reviewed manifest');
  assert.equal(value.schema, 'nirs4all.studio.reviewed-promotion.v2');
  assert.equal(value.version, VERSION);
  assert(typeof value.source_sha === 'string' && /^[0-9a-f]{40}$/.test(value.source_sha), 'Invalid immutable runtime SHA');
  const runIds = ['release_run_id', 'ci_run_id', 'version_run_id'].map(key => {
    positive(value[key], key); return value[key];
  });
  assert.equal(new Set(runIds).size, 3, 'Gate run IDs must be distinct');
  closed(value.local_qualification, ['path', 'sha256'], 'Local qualification');
  assert.equal(value.local_qualification.path, 'qualification/local-qualification.json');
  digest(value.local_qualification.sha256, 'local qualification SHA256');
  closed(value.artifacts, Object.keys(ARTIFACT_NAMES), 'Artifacts');
  for (const [key, name] of Object.entries(ARTIFACT_NAMES)) {
    const artifact = value.artifacts[key]; closed(artifact, ['id', 'name', 'digest'], `Artifact ${key}`);
    positive(artifact.id, 'artifact ID'); assert.equal(artifact.name, name);
    assert(typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(artifact.digest), 'Invalid GitHub artifact digest');
  }
  assert.equal(new Set(Object.values(value.artifacts).map(item => item.id)).size, 4, 'Artifact IDs must be distinct');
  const expected = expectedPublishedNames(VERSION, false, false).flatMap(name => [name, `${name}.sha256`]).sort();
  assert(Array.isArray(value.files), 'Missing reviewed files');
  const producers = expected.map(name => name.replace('nirs4all.Studio-', 'nirs4all Studio-'));
  assert(Array.isArray(value.producer_files), 'Missing reviewed producer files');
  assert.deepEqual(value.producer_files.map(item => item.name).sort(), producers.sort(), 'Exactly six reviewed producer files required');
  for (const file of value.producer_files) {
    closed(file, ['name', 'size', 'sha256'], 'Producer file'); positive(file.size, 'producer size'); digest(file.sha256, 'producer SHA256');
  }
  assert.deepEqual(value.files.map(item => item.name).sort(), expected, 'Exactly three installers and their checksums are required');
  for (const file of value.files) {
    closed(file, ['name', 'size', 'sha256'], 'File'); positive(file.size, 'file size'); digest(file.sha256, 'file SHA256');
  }
  closed(value.docker, ['size', 'sha256', 'image_id'], 'Docker');
  positive(value.docker.size, 'Docker tar size'); digest(value.docker.sha256, 'Docker tar SHA256');
  assert(typeof value.docker.image_id === 'string' && /^sha256:[0-9a-f]{64}$/.test(value.docker.image_id), 'Invalid reviewed Docker image ID');
  digest(value.notes_sha256, 'reviewed release notes SHA256');
  return value;
}
function requiredJobs(jobs, names) {
  assert(Array.isArray(jobs), 'Malformed jobs inventory');
  for (const name of names) {
    const matches = jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1, `Missing/ambiguous gate ${name}`);
    assert(matches[0].status === 'completed' && matches[0].conclusion === 'success', `Gate did not succeed: ${name}`);
  }
}
async function verifyGates(manifest, api) {
  const m = validateManifest(manifest);
  const gates = [
    [m.release_run_id, '.github/workflows/release-unified.yml', 'workflow_dispatch', RELEASE_JOBS],
    [m.ci_run_id, '.github/workflows/ci.yml', 'push', CI_JOBS],
    [m.version_run_id, '.github/workflows/version-guard.yml', 'push', ['version-guard']],
  ];
  for (const [id, workflow, event, names] of gates) {
    const run = await api(`actions/runs/${id}`);
    assert.equal(run.id, id); assert.equal(run.head_sha, m.source_sha); assert.equal(run.path, workflow);
    assert.equal(run.event, event); assert.equal(run.head_branch, 'main');
    assert(run.status === 'completed' && run.conclusion === 'success', 'Only completed successful exact-source runs can be promoted');
    const jobs = await api(`actions/runs/${id}/jobs?per_page=100`);
    assert.equal(jobs.total_count, jobs.jobs?.length, 'Job inventory truncated');
    requiredJobs(jobs.jobs, names);
    if (id === m.release_run_id) {
      const intel = jobs.jobs.filter(job => job.name === 'Installer — macOS x64');
      assert(intel.length === 1 && intel[0].status === 'completed' && intel[0].conclusion === 'skipped', 'Intel Mac must remain outside this promotion');
      const publication = jobs.jobs.filter(job => job.name === 'Create Release');
      assert.equal(publication.length, 1);
      for (const name of ['Publish the tested Docker image', 'Publish verified assets sequentially']) {
        const steps = publication[0].steps?.filter(step => step.name === name);
        assert(steps?.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'skipped', 'Candidate publication must remain skipped');
      }
    }
  }
  const inventory = await api(`actions/runs/${m.release_run_id}/artifacts?per_page=100`);
  assert.equal(inventory.total_count, inventory.artifacts?.length, 'Artifact inventory truncated');
  for (const expected of Object.values(m.artifacts)) {
    const matches = inventory.artifacts.filter(item => item.name === expected.name);
    assert.equal(matches.length, 1, 'Reviewed artifact is absent or ambiguous');
    const item = matches[0]; assert.equal(item.id, expected.id); assert(!item.expired, 'Reviewed artifact has expired');
    assert.equal(item.digest, expected.digest, 'Reviewed artifact digest changed');
    assert.equal(item.workflow_run?.id, m.release_run_id); assert.equal(item.workflow_run?.head_sha, m.source_sha);
  }
  const ancestry = await api(`compare/${m.source_sha}...main`);
  assert(['ahead', 'identical'].includes(ancestry.status) && ancestry.merge_base_commit?.sha === m.source_sha,
    'Reviewed runtime must be integrated into current main');
}
function stageProducerPayloads(manifest, root, folders) {
  const m = validateManifest(manifest);
  for (const expected of m.producer_files) {
    const matches = folders.map(folder => path.join(folder, expected.name)).filter(file => fs.existsSync(file));
    assert.equal(matches.length, 1, `Missing/ambiguous producer file: ${expected.name}`);
    const source = matches[0]; assert.equal(plainFile(source).size, expected.size);
    assert.equal(sha256File(source), expected.sha256, `Reviewed producer bytes differ: ${expected.name}`);
    fs.copyFileSync(source, path.join(root, 'release', expected.name), fs.constants.COPYFILE_EXCL);
  }
  // Existing release behavior: unchanged installer bytes, normalized public
  // basenames, and regenerated sidecars whose exact bytes are reviewed too.
  finalizeReleaseAssets(path.join(root, 'release'), expectedPublishedNames(VERSION, false, false));
}
function plainFile(file) { const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink(), 'Payload must be a regular non-symlink file'); return stat; }
function verifyPayloads(manifest, root, notes) {
  const m = validateManifest(manifest);
  const actual = releaseManifest(path.join(root, 'release'), VERSION, false, false);
  for (const expected of m.files) {
    const file = actual.find(item => item.name === expected.name);
    assert(file && file.size === expected.size && file.sha256 === expected.sha256, `Reviewed payload differs: ${expected.name}`);
  }
  const tar = path.join(root, 'docker', 'studio-image.tar');
  assert.equal(plainFile(tar).size, m.docker.size); assert.equal(sha256File(tar), m.docker.sha256);
  plainFile(notes); assert.equal(sha256File(notes), m.notes_sha256, 'Release notes were not reviewed');
}
async function command(program, args) {
  // Commands never print child diagnostics, argv or credentials on failure.
  return (await execFileAsync(program, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30 * 60 * 1000 })).stdout;
}
async function verifyLocalQualification(manifest, execute = command) {
  const m = validateManifest(manifest);
  plainFile(m.local_qualification.path);
  assert.equal(sha256File(m.local_qualification.path), m.local_qualification.sha256, 'Reviewed local qualification bytes differ');
  // The shared verifier checks actual local host/command/log/report facts and
  // unchanged runtime/dependency/fixture/helper inputs; CI/doc changes do not replay E2E.
  await execute('python3', ['scripts/verify_local_qualification.py', '--project', 'studio',
    '--receipt', m.local_qualification.path, '--root', '.']);
}
async function main(argv = process.argv.slice(2), env = process.env) {
  assert(argv.length === 1 && ['verify', 'publish'].includes(argv[0]), 'Usage: promote-reviewed-0151.cjs verify|publish');
  assert.equal(env.GITHUB_REPOSITORY, REPO); assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REF, 'refs/heads/main'); assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.GITHUB_WORKFLOW, 'Publish reviewed Studio 0.15.1');
  // Manifest and notes are tracked, independently reviewed source; no input ref/path/digest is accepted.
  const manifest = validateManifest(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
  await verifyLocalQualification(manifest);
  const api = async endpoint => JSON.parse(await command('gh', ['api', `repos/${REPO}/${endpoint}`]));
  await verifyGates(manifest, api);
  const root = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'reviewed-studio0151-'));
  fs.mkdirSync(path.join(root, 'release'));
  for (const [key, artifact] of Object.entries(manifest.artifacts)) {
    const folder = path.join(root, key);
    await command('gh', ['run', 'download', String(manifest.release_run_id), '-R', REPO, '--name', artifact.name, '--dir', folder]);
  }
  stageProducerPayloads(manifest, root, ['linux', 'windows', 'macos'].map(key => path.join(root, key)));
  verifyPayloads(manifest, root, NOTES);
  await command('docker', ['load', '--input', path.join(root, 'docker', 'studio-image.tar')]);
  const image = JSON.parse(await command('docker', ['image', 'inspect', 'nirs4all-studio:native-release-candidate']));
  assert.equal(image.length, 1); assert.equal(image[0].Id, manifest.docker.image_id);
  assert.equal(image[0].Config.Labels['org.opencontainers.image.revision'], manifest.source_sha);
  assert.equal(image[0].Config.Labels['org.opencontainers.image.version'], VERSION);
  if (argv[0] === 'verify') { console.log('Reviewed Studio 0.15.1 exact artifacts verified; no publication'); return; }
  // Recheck live gates immediately before any write. This workflow supplies only github.token.
  // Git refs created with GITHUB_TOKEN do not trigger push workflows: release-unified cannot rebuild concurrently.
  await verifyGates(manifest, api);
  await verifyLocalQualification(manifest);
  let tag;
  try { tag = await api(`git/ref/tags/${VERSION}`); }
  catch (error) {
    if (!/\(HTTP 404\)/.test(String(error.stderr || ''))) throw new Error('Cannot read immutable release tag');
    tag = JSON.parse(await command('gh', ['api', `repos/${REPO}/git/refs`, '-X', 'POST', '-f', `ref=refs/tags/${VERSION}`, '-f', `sha=${manifest.source_sha}`]));
  }
  assert(tag.object?.type === 'commit' && tag.object.sha === manifest.source_sha, 'Existing tag differs; never retag');
  const repository = 'ghcr.io/gbeurier/nirs4all-studio';
  for (const label of [VERSION, 'latest']) {
    await command('docker', ['tag', manifest.docker.image_id, `${repository}:${label}`]);
    await command('docker', ['push', `${repository}:${label}`]);
  }
  await publishQualifiedRelease({ repo: REPO, tag: VERSION, version: VERSION, sha: manifest.source_sha,
    prerelease: false, includeAllInOne: false, includeMacosX64: false, releaseRoot: path.join(root, 'release'), notesPath: NOTES, reviewedNotesSha256: manifest.notes_sha256 });
  console.log('Published only the exact reviewed Studio 0.15.1 installers and Docker image');
}
if (require.main === module) main().catch(error => { console.error(error.cmd ? 'Reviewed promotion command failed' : error.message); process.exitCode = 1; });
module.exports = { ARTIFACT_NAMES, CI_JOBS, RELEASE_JOBS, validateManifest, verifyGates, verifyLocalQualification, stageProducerPayloads, verifyPayloads, main };
