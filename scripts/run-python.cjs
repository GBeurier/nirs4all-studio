#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const passthroughArgs = process.argv.slice(2);

function candidateCommands() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push({ command: process.env.PYTHON, prefixArgs: [] });
  }

  candidates.push(
    {
      command: path.join(projectRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      prefixArgs: [],
    },
    { command: "python3.11", prefixArgs: [] },
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  );

  if (process.platform === "win32") {
    candidates.push({ command: "py", prefixArgs: ["-3.11"] });
    candidates.push({ command: "py", prefixArgs: ["-3"] });
  }

  return candidates;
}

function canRunPython(candidate) {
  if (candidate.command.includes(path.sep) && !fs.existsSync(candidate.command)) {
    return false;
  }

  const result = spawnSync(candidate.command, [...candidate.prefixArgs, "--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0;
}

function resolvePython() {
  return candidateCommands().find(canRunPython) ?? null;
}

const python = resolvePython();
if (!python) {
  console.error("No Python interpreter found. Create .venv or set PYTHON to a Python >=3.11 executable.");
  process.exit(1);
}

const result = spawnSync(python.command, [...python.prefixArgs, ...passthroughArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
