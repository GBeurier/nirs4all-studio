const fs = require('node:fs');
const path = require('node:path');
const { publishQualifiedRelease } = require('./publish-qualified-release.cjs');
const { independentDeliveryNotes } = require('./stage-release-channel.cjs');

async function prepareReleaseDraft(options, dependencies = {}) {
  return publishQualifiedRelease({ ...options, prepareOnly: true, channel: null }, dependencies);
}
async function main(env = process.env) {
  const notesPath = path.join(env.RUNNER_TEMP, 'installer-channel-notes.md');
  const repo = env.GH_REPO || env.GITHUB_REPOSITORY;
  fs.writeFileSync(notesPath, independentDeliveryNotes(env.RELEASE_VERSION, env.RELEASE_SHA,
    `https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}`));
  return prepareReleaseDraft({ repo, tag: env.RELEASE_TAG, version: env.RELEASE_VERSION,
    sha: env.RELEASE_SHA, prerelease: env.RELEASE_PRERELEASE === 'true', notesPath });
}
if (require.main === module) main().catch((error) => {
  console.error(error.cmd ? 'GitHub draft preparation failed' : error.message); process.exitCode = 1;
});
module.exports = { prepareReleaseDraft, main };
