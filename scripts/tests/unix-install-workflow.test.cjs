const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const yaml = require('js-yaml');
const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/unix-real-install-update.yml'), 'utf8'));
const steps = workflow.jobs['install-and-migrate'].steps;

test('DEB executable selection excludes similarly named documentation directories', () => {
  const script = steps.find(step => step.name === 'Install the actual DEB package').run;
  const expression = script.match(/\| awk '([^']+)'/)[1];
  const selected = execFileSync('awk', [expression], { input: '/opt/nirs4all Studio/nirs4all-webapp\n/usr/share/doc/nirs4all-webapp\n/usr/bin/nirs4all-webapp\n', encoding: 'utf8' }).trim();
  assert.equal(selected, '/opt/nirs4all Studio/nirs4all-webapp');
});

test('all macOS smoke commands keep a nonempty launcher under nounset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unix-launch-test-'));
  try {
    fs.writeFileSync(path.join(root, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const probes = steps.filter(step => step.run?.includes('LAUNCH='));
    assert.equal(probes.length, 3);
    for (const step of probes) {
      // Bash 3.2 on macOS rejects expansion of empty arrays under `set -u`.
      assert.match(step.run, /LAUNCH=\(node\)/);
      const output = execFileSync('bash', ['-c', step.run], { encoding: 'utf8', env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PLATFORM: 'darwin', INSTALLED_ROOT: '/tmp/app with spaces.app', CANDIDATE_ARCHIVE: '/tmp/archive with spaces.zip', RUNNER_TEMP: root } });
      assert.match(output, /scripts\/(?:smoke-|verify-real-release)/);
      assert.match(output, /(?:app with spaces\.app|archive with spaces\.zip)/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
