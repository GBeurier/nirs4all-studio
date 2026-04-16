const path = require("path");

const isWindows = process.platform === "win32";
const CMD_WRAPPED_COMMANDS = new Set([
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
]);

function resolveSpawnCommand(command, args = []) {
  if (!isWindows) {
    return {
      command,
      args,
      shell: false,
    };
  }

  const normalized = path.basename(command).toLowerCase();
  if (!CMD_WRAPPED_COMMANDS.has(normalized)) {
    return {
      command,
      args,
      shell: false,
    };
  }

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
    shell: false,
  };
}

module.exports = {
  resolveSpawnCommand,
};
