const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { expectedPublishedNames } = require('./finalize-release-assets.cjs');
const { independentDeliveryNotes } = require('./stage-release-channel.cjs');
const execute = promisify(execFile);

const JOBS = {
  'linux-standard': 'Installer — Linux x64 (standard)',
  'linux-offline': 'Installer — Linux x64 (offline)',
  'windows-standard': 'Installer — Windows x64 (standard)',
  'windows-offline': 'Installer — Windows x64 (offline)',
  'macos-arm64': 'Installer — macOS arm64',
};

function deliveryState(version, channel, assets, jobs) {
  const [name] = expectedPublishedNames(version, channel);
  const pair = [name, `${name}.sha256`].map((file) => assets.find((asset) => asset.name === file));
  if (pair.every((asset) => asset?.state === 'uploaded' && asset.size > 0 && /^sha256:[0-9a-f]{64}$/.test(asset.digest))) {
    return 'available';
  }
  const job = jobs.find((item) => item.name === JOBS[channel]);
  if (['failure', 'cancelled', 'timed_out', 'action_required'].includes(job?.conclusion)) return `failed (${job.conclusion})`;
  return job?.conclusion === 'skipped' ? 'pending (not selected)' : 'pending';
}

async function reportReleaseDeliveries(options, dependencies = {}) {
  const gh = dependencies.gh || (async (args) => (await execute('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout);
  const { repo, tag, version, sha, prerelease, runId } = options;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !/^\d+$/.test(String(runId)) || tag !== version) {
    throw new Error('Exact repository, source tag and workflow run are required');
  }
  const api = `repos/${repo}`;
  let release;
  try { release = JSON.parse(await gh(['api', `${api}/releases/tags/${encodeURIComponent(tag)}`])); }
  catch (error) {
    if (/\(HTTP 404\)/.test(String(error.stderr || ''))) return { updated: false, reason: 'No installer channel has published a release yet' };
    throw error;
  }
  if (release.tag_name !== tag || release.prerelease !== prerelease || release.draft !== false ||
    !release.body?.includes(`*Application source: ${sha}*`)) throw new Error('Published delivery source identity differs');
  const pages = JSON.parse(await gh(['api', `${api}/actions/runs/${runId}/jobs?per_page=100`, '--paginate', '--slurp']));
  const jobs = pages.flatMap((page) => page.jobs);
  const assets = JSON.parse(await gh(['api', `${api}/releases/${release.id}/assets?per_page=100`, '--paginate', '--slurp'])).flat();
  let body = independentDeliveryNotes(version, sha, `https://github.com/${repo}/actions/runs/${runId}`);
  body += '\n### Delivery status\n\n| Channel | State |\n|---|---|\n';
  for (const channel of Object.keys(JOBS)) body += `| ${channel} | ${deliveryState(version, channel, assets, jobs)} |\n`;
  const docker = jobs.find((job) => job.name === 'Native Docker Image');
  body += `| Docker | ${docker?.conclusion === 'success' ? 'published in this run' : ['failure', 'cancelled', 'timed_out'].includes(docker?.conclusion) ? `failed (${docker.conclusion})` : 'not attempted in this run'} |\n`;
  body += '\nAvailable means the installer and its checksum are attached; it does not requalify another channel. Retry pending or failed channels independently against the same immutable source tag.\n';
  await gh(['api', `${api}/releases/${release.id}`, '--method', 'PATCH', '--raw-field', `body=${body}`]);
  return { updated: true, releaseId: release.id };
}

async function main(env = process.env) {
  return reportReleaseDeliveries({ repo: env.GH_REPO || env.GITHUB_REPOSITORY, tag: env.RELEASE_TAG,
    version: env.RELEASE_VERSION, sha: env.RELEASE_SHA, prerelease: env.RELEASE_PRERELEASE === 'true', runId: env.GITHUB_RUN_ID });
}
if (require.main === module) main().catch((error) => { console.error(error.cmd ? 'GitHub delivery status operation failed' : error.message); process.exitCode = 1; });
module.exports = { deliveryState, reportReleaseDeliveries, main };
