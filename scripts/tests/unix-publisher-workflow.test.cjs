const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const yaml = require('js-yaml');
const vm = require('node:vm');

for (const filename of ['publish-qualified-unix-hotfix.yml', 'publish-qualified-macintel-hotfix.yml']) {
test(`${filename} adds checksums first and refuses to replace an existing different payload`, () => {
  const publisher = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows', filename), 'utf8'));
  const publishStep = publisher.jobs.publish.steps.find(step => step.name === 'Add only verified new assets without replacing existing release files');
  const code = publishStep.run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
  function simulate(existing) {
    const uploads = [], assets = [...existing];
    const names = ['app.zip', 'app.zip.sha256'];
    const execute = (_program, args) => {
      if (args[0] === 'api') return JSON.stringify({ assets });
      assert.equal(args.slice(0, 3).join(' '), 'release upload 0.11.5');
      assert.equal(args.length, 4, 'No clobber or release edit flags are allowed');
      const name = path.basename(args[3]); uploads.push(name);
      assets.push({ name, state: 'uploaded', digest: `sha256:${name}` });
    };
    vm.runInNewContext(code, { process: { env: { GH_REPO: 'test/repo' } }, require: name => {
      if (name === 'node:fs') return { readdirSync: () => [...names] };
      if (name === 'node:child_process') return { execFileSync: execute };
      if (name === './scripts/finalize-release-assets.cjs') return { sha256File: file => path.basename(file) };
      return require(name);
    } });
    return uploads;
  }
  assert.deepEqual(simulate([]), ['app.zip.sha256', 'app.zip']);
  assert.deepEqual(simulate([{ name: 'app.zip', state: 'uploaded', digest: 'sha256:app.zip' }]), ['app.zip.sha256']);
  assert.throws(() => simulate([{ name: 'app.zip', state: 'uploaded', digest: 'sha256:different' }]), /Refusing to replace/);
});
}
