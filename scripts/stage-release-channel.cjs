const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalPublishedName, expectedPublishedNames, finalizeReleaseAssets,
} = require('./finalize-release-assets.cjs');

function stageReleaseChannel(sourceRoot, destination, version, channel) {
  const [expected] = expectedPublishedNames(version, channel);
  if (channel === null || channel === undefined) throw new Error('An explicit delivery channel is required');
  const source = path.resolve(sourceRoot);
  const target = path.resolve(destination);
  const stat = fs.lstatSync(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Installer source must be a real directory');
  const candidates = fs.readdirSync(source).filter((name) => {
    if (!/\.(deb|exe|dmg)$/.test(name)) return false;
    return canonicalPublishedName(name) === expected;
  });
  if (candidates.length !== 1) throw new Error(`Expected exactly one ${channel} installer`);
  fs.mkdirSync(target);
  const name = candidates[0];
  for (const suffix of ['', '.sha256']) {
    const input = path.join(source, name + suffix);
    const info = fs.lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Installer and checksum must be real files');
    fs.copyFileSync(input, path.join(target, name + suffix), fs.constants.COPYFILE_EXCL);
  }
  return finalizeReleaseAssets(target, [expected]);
}

function independentDeliveryNotes(version, sourceSha, workflowUrl) {
  expectedPublishedNames(version);
  if (!/^[0-9a-f]{40}$/.test(sourceSha || '')) throw new Error('Immutable release source is required');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(workflowUrl || '')) {
    throw new Error('A GitHub delivery workflow URL is required');
  }
  return `## nirs4all Studio ${version}\n\n` +
    'Installers and Docker are delivered independently. Only the attached installer/checksum pairs are available. ' +
    `Other channels are pending or failed; see the [delivery jobs](${workflowUrl}) and retry those channels independently.\n\n` +
    'On first launch Studio uses your selected Python environment or creates one and installs its pinned packages. ' +
    'Offline Windows/Linux installers also include the Python runtime, default packages, XGBoost and CPU PyTorch.\n\n' +
    'Each attached installer passed its own packaged-runtime and application smoke before publication. ' +
    'Verify its matching `.sha256` file after downloading.\n\n' +
    `*Application source: ${sourceSha}*\n`;
}

function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 4) throw new Error('Usage: node scripts/stage-release-channel.cjs <source> <destination> <version> <channel>');
  const records = stageReleaseChannel(...argv);
  const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GH_REPO || env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  fs.writeFileSync(env.RELEASE_NOTES_PATH || 'release_notes.md', independentDeliveryNotes(argv[2], env.RELEASE_SHA, url));
  return records;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { stageReleaseChannel, independentDeliveryNotes, main };
