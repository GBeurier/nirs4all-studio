const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertDockerCjsModuleGraph } = require("../docker-cjs-module-graph.cjs");

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-docker-cjs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}
function verify(root, copies) {
  return assertDockerCjsModuleGraph({ projectRoot: root,
    dockerfile: `FROM node:24 AS python-plugin-runtime\nWORKDIR /build\n${copies}\n`,
    stageName: "python-plugin-runtime", entrypoints: ["scripts/main.cjs"] });
}

test("actual Python build stage has a closed CommonJS dependency graph", () => {
  const root = path.resolve(__dirname, "../..");
  assertDockerCjsModuleGraph({ projectRoot: root,
    dockerfile: fs.readFileSync(path.join(root, "Dockerfile"), "utf8"),
    stageName: "python-plugin-runtime",
    entrypoints: ["scripts/bake-python-plugin-runtime.cjs", "scripts/setup-python-env.cjs"] });
});

test("checks an arbitrary deferred transitive require rather than one helper name", (t) => {
  const root = fixture(t, {
    "scripts/main.cjs": "module.exports = require('./first.cjs');",
    "scripts/first.cjs": "module.exports = () => require('./future-helper.cjs');",
    "scripts/future-helper.cjs": "module.exports = 42;",
  });
  const incomplete = "COPY scripts/main.cjs scripts/first.cjs scripts/";
  assert.throws(() => verify(root, incomplete), /first\.cjs -> \.\/future-helper\.cjs/);
  const complete = incomplete + "\nCOPY scripts/future-helper.cjs scripts/";
  assert.equal(verify(root, complete).checkedModules, 3);
});

test("source presence alone does not satisfy a require at the wrong image path", (t) => {
  const root = fixture(t, {
    "scripts/main.cjs": "module.exports = require('./helper.cjs');",
    "scripts/helper.cjs": "module.exports = 42;",
  });
  assert.throws(() => verify(root,
    "COPY scripts/main.cjs scripts/\nCOPY scripts/helper.cjs /elsewhere/helper.cjs"),
  /main\.cjs -> \.\/helper\.cjs/);
});

test("resolves parent JSON and ignores Node builtins with JSON COPY syntax", (t) => {
  const root = fixture(t, {
    "scripts/main.cjs": "require('node:fs'); require('path'); module.exports = require('../settings.json');",
    "settings.json": "{}",
  });
  assert.equal(verify(root,
    'COPY ["scripts/main.cjs", "scripts/"]\nCOPY settings.json ./').checkedModules, 2);
});

test("requires the actual launch entrypoint even when no CJS files were copied", (t) => {
  const root = fixture(t, { "settings.json": "{}" });
  assert.throws(() => verify(root, "COPY settings.json ./"), /Missing CJS entrypoint/);
});

test("does not silently accept an unstaged npm dependency", (t) => {
  const root = fixture(t, { "scripts/main.cjs": "require('unavailable-package');" });
  assert.throws(() => verify(root, "COPY scripts/main.cjs scripts/"), /Unstaged external CJS dependency/);
});
