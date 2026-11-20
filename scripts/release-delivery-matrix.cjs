const fs = require('node:fs');
const { expectedPublishedNames } = require('./finalize-release-assets.cjs');

function deliveryMatrix(selected = 'all', macosOnly = false, skipDocker = false) {
  let channel = selected;
  if (macosOnly) {
    if (!['all', 'macos-arm64'].includes(channel)) throw new Error('macOS-only selection conflicts with delivery_channel');
    channel = 'macos-arm64';
  }
  if (!['all', 'docker'].includes(channel)) expectedPublishedNames('0.0.0', channel);
  if (channel === 'docker' && skipDocker) throw new Error('Docker delivery cannot be selected and skipped');
  const matrix = (platform) => ({ include: ['standard', 'offline']
    .filter((variant) => !channel.startsWith(platform + '-') || channel === `${platform}-${variant}`)
    .map((variant) => ({ variant, builder_config: variant === 'standard' ? 'electron-builder.installer.yml' : 'electron-builder.offline.yml' })) });
  return { delivery_channel: channel, macos_arm64_only: String(macosOnly), skip_docker: String(skipDocker),
    linux_matrix: JSON.stringify(matrix('linux')), windows_matrix: JSON.stringify(matrix('windows')) };
}
function main(env = process.env) {
  const outputs = deliveryMatrix(env.SELECTED_CHANNEL || 'all', env.MACOS_ONLY === 'true', env.SKIP_DOCKER === 'true');
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  return outputs;
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { deliveryMatrix, main };
