const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { expectedPublishedNames, sha256File } = require('../finalize-release-assets.cjs');
const { deliveryMatrix } = require('../release-delivery-matrix.cjs');
const { stageReleaseChannel, independentDeliveryNotes } = require('../stage-release-channel.cjs');
const { deliveryState, reportReleaseDeliveries } = require('../report-release-deliveries.cjs');

for (const channel of ['all', 'linux-standard', 'linux-offline', 'windows-standard', 'windows-offline', 'macos-arm64', 'docker']) {
  test(`delivery selection ${channel} retains only the requested variant`, () => {
    const result = deliveryMatrix(channel);
    assert.equal(result.delivery_channel, channel);
    for (const platform of ['linux', 'windows']) {
      const variants = JSON.parse(result[`${platform}_matrix`]).include.map((item) => item.variant);
      assert.deepEqual(variants, channel.startsWith(platform + '-') ? [channel.slice(platform.length + 1)] : ['standard', 'offline']);
    }
  });
}
test('legacy macOS diagnostics stay selectable; conflicting channel choices refuse', () => {
  assert.equal(deliveryMatrix('all', true, true).delivery_channel, 'macos-arm64');
  assert.throws(() => deliveryMatrix('windows-standard', true), /conflicts/);
  assert.throws(() => deliveryMatrix('docker', false, true), /selected and skipped/);
  assert.throws(() => deliveryMatrix('typo'), /Unknown installer/);
});

for (const channel of ['linux-standard', 'linux-offline', 'windows-standard', 'windows-offline', 'macos-arm64']) {
  test(`${channel} staging verifies the exact pair and canonical filename`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-channel-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    const [name] = expectedPublishedNames('0.19.0', channel);
    const original = name.replace('nirs4all.Studio', 'nirs4all Studio');
    const file = path.join(source, original); fs.writeFileSync(file, 'qualified bytes\n');
    fs.writeFileSync(file + '.sha256', `${sha256File(file)}  ${original}\n`);
    const output = path.join(root, 'selected');
    stageReleaseChannel(source, output, '0.19.0', channel);
    assert.deepEqual(fs.readdirSync(output).sort(), [name, name + '.sha256'].sort());
    assert.equal(fs.readFileSync(path.join(output, name), 'utf8'), 'qualified bytes\n');
    assert.match(fs.readFileSync(path.join(output, name + '.sha256'), 'utf8'), new RegExp(`  ${name.replaceAll('.', '\\.')}`));
    assert.throws(() => stageReleaseChannel(source, path.join(root, 'wrong'), '0.19.1', channel), /exactly one/);
  });
}

test('delivery notes describe absent channels without promising unpublished Docker', () => {
  const notes = independentDeliveryNotes('0.19.0', 'a'.repeat(40), 'https://github.com/owner/studio/actions/runs/42');
  assert.match(notes, /pending or failed/);
  assert(!notes.includes('docker pull'));
  assert.throws(() => independentDeliveryNotes('0.19.0', 'main', 'https://github.com/owner/studio/actions/runs/42'), /Immutable/);
});

test('availability requires both uploaded files; producer failure remains explicit', () => {
  const [name] = expectedPublishedNames('0.19.0', 'linux-standard');
  const assets = [{ name, size: 123, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64) }];
  const jobs = [{ name: 'Installer — Linux x64 (standard)', conclusion: 'failure' }];
  assert.equal(deliveryState('0.19.0', 'linux-standard', assets, jobs), 'failed (failure)');
  assets.push({ ...assets[0], name: name + '.sha256' });
  assert.equal(deliveryState('0.19.0', 'linux-standard', assets, jobs), 'available');
  assert.equal(deliveryState('0.19.0', 'macos-arm64', assets, jobs), 'pending');
});

test('reporting preserves the source identity and labels failed or pending channels', async () => {
  const sha = 'b'.repeat(40); const calls = [];
  const options = { repo: 'owner/studio', tag: '0.19.0', version: '0.19.0', sha, prerelease: false, runId: 42 };
  const gh = async (args) => {
    calls.push(args);
    if (args[1].endsWith('releases/tags/0.19.0')) return JSON.stringify({ id: 12, tag_name: '0.19.0', prerelease: false, draft: false, body: `*Application source: ${sha}*` });
    if (args[1].includes('/jobs?')) return JSON.stringify([{ jobs: [{ name: 'Installer — macOS arm64', conclusion: 'failure' }] }]);
    if (args[1].includes('/assets?')) return JSON.stringify([[]]);
    assert(args.includes('PATCH')); assert.match(args.at(-1), /macos-arm64 \| failed \(failure\)/);
    assert.match(args.at(-1), /windows-standard \| pending/);
    return '{}';
  };
  assert.equal((await reportReleaseDeliveries(options, { gh })).updated, true);
  assert.equal(calls.filter((args) => args.includes('PATCH')).length, 1);
});
