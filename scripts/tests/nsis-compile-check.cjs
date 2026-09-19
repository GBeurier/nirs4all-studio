#!/usr/bin/env node
// Compile both real electron-builder NSIS phases, with no product build or
// installer execution. The tiny fixture and all outputs stay outside the repo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const builder = require('electron-builder');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
let executionTarget;
let executionMethod;
try {
  executionTarget = require('app-builder-lib/out/vm/WineVm').WineVmManager.prototype;
  executionMethod = 'exec';
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  executionTarget = require('app-builder-lib/out/wine');
  executionMethod = 'execWine';
}
const yaml = require('js-yaml');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-nsis-compile-'));
  const stage = path.join(temporary, 'payload');
  const outputRoot = path.join(temporary, 'output');
  const configuration = path.join(root, 'electron-builder.installer.yml');
  const productName = yaml.load(fs.readFileSync(configuration, 'utf8')).productName;
  fs.mkdirSync(path.join(stage, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(stage, `${productName}.exe`), 'Compiler fixture only: not an executable.');
  fs.writeFileSync(path.join(stage, 'resources', 'proof.txt'), 'Never distribute or execute this compile fixture.');
  const originalCompile = NsisTarget.prototype.executeMakensis;
  const originalWine = executionTarget[executionMethod];
  const phases = [];
  let uninstallerOutput;
  NsisTarget.prototype.executeMakensis = async function(defines, commands, script, ...options) {
    const phase = Object.hasOwn(defines, 'BUILD_UNINSTALLER') ? 'uninstaller' : 'installer';
    if (phase === 'uninstaller') {
      uninstallerOutput = defines.UNINSTALLER_OUT_FILE.replace(/^Z:/, '').replace(/\\/g, '/');
    }
    // Keep the real compiler, include order, flags and generated script intact.
    await originalCompile.call(this, defines, commands, script, ...options);
    phases.push(phase);
  };
  executionTarget[executionMethod] = async (input) => {
    assert(input.startsWith(`${outputRoot}${path.sep}`), 'Unexpected installer outside the fixture');
    assert(uninstallerOutput.startsWith(`${outputRoot}${path.sep}`), 'Unexpected uninstaller outside the fixture');
    // The production generator is compiled, but never executed on the host.
    await UninstallerReader.exec(input, uninstallerOutput);
  };
  try {
    await builder.build({
      projectDir: root,
      win: ['nsis'], x64: true, prepackaged: stage, publish: 'never',
      config: {
        extends: configuration,
        directories: { output: outputRoot },
        win: { signAndEditExecutable: false },
        nsis: { warningsAsErrors: true },
      },
    });
    assert.deepEqual(phases, ['uninstaller', 'installer']);
    console.log('NSIS compile check passed: real uninstaller and installer, warnings treated as errors.');
  } finally {
    NsisTarget.prototype.executeMakensis = originalCompile;
    executionTarget[executionMethod] = originalWine;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
