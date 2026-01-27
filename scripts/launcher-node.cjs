#!/usr/bin/env node
/**
 * Cross-platform launcher for nirs4all webapp
 * Delegates to launcher.sh (Linux/macOS) or launcher.cmd (Windows)
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const scriptsDir = __dirname;

const isWindows = os.platform() === 'win32';

if (isWindows) {
    // Windows: use launcher.cmd
    const cmdPath = path.join(scriptsDir, 'launcher.cmd');
    const child = spawn('cmd.exe', ['/c', cmdPath, ...args], {
        stdio: 'inherit',
        cwd: path.dirname(scriptsDir),
        shell: false
    });
    child.on('close', (code) => process.exit(code || 0));
} else {
    // Linux/macOS: use launcher.sh
    const shPath = path.join(scriptsDir, 'launcher.sh');
    const child = spawn('bash', [shPath, ...args], {
        stdio: 'inherit',
        cwd: path.dirname(scriptsDir),
        shell: false
    });
    child.on('close', (code) => process.exit(code || 0));
}
