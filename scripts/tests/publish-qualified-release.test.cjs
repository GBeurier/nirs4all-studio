const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { expectedPublishedNames, sha256File } = require("../finalize-release-assets.cjs");
const { ghFailureDiagnostic, publishQualifiedRelease, releaseManifest } = require("../publish-qualified-release.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-publisher-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, "release");
  fs.mkdirSync(releaseRoot);
  for (const name of expectedPublishedNames("0.11.7")) {
    const file = path.join(releaseRoot, name);
    fs.writeFileSync(file, `qualified product bytes: ${name}\n`);
    fs.writeFileSync(`${file}.sha256`, `${sha256File(file)}  ${name}\n`);
  }
  const notesPath = path.join(root, "notes.md");
  fs.writeFileSync(notesPath, "Qualified release\n");
  return { repo: "owner/studio", tag: "0.11.7", version: "0.11.7", sha: "b".repeat(40),
    prerelease: false, includeAllInOne: true, releaseRoot, notesPath };
}

function github(options, behavior = {}) {
  const manifest = releaseManifest(options.releaseRoot, options.version, options.includeAllInOne);
  let nextId = 100;
  const state = {
    release: behavior.absent ? null : { id: 99, tag_name: options.tag, draft: true,
      prerelease: options.prerelease, target_commitish: "main" },
    assets: [], calls: [], mutations: [], waits: [], attempts: new Map(), active: 0, maxActive: 0, deletedAssets: [],
  };
  state.asset = (entry) => ({ id: nextId++, name: entry.name, size: entry.size,
    state: "uploaded", digest: `sha256:${entry.sha256}` });
  const gh = async (args) => {
    state.calls.push(args);
    if (args[0] === "api") {
      const endpoint = args[1].replace(`repos/${options.repo}/`, "");
      if (endpoint === `git/ref/tags/${options.tag}`) {
        return JSON.stringify({ object: behavior.annotated
          ? { type: "tag", sha: "c".repeat(40) }
          : { type: "commit", sha: behavior.tagSha || options.sha } });
      }
      if (endpoint === `git/tags/${"c".repeat(40)}`) {
        return JSON.stringify({ object: { type: "commit", sha: behavior.tagSha || options.sha } });
      }
      if (endpoint === `releases/tags/${options.tag}`) {
        if (!state.release || behavior.lookupFailure || (behavior.draftHidden && state.release.draft)) {
          const error = new Error("gh request failed");
          error.stderr = `gh: request failed (HTTP ${behavior.lookupFailure || 404})`;
          throw error;
        }
        return JSON.stringify(state.release);
      }
      if (endpoint === "releases?per_page=100") {
        assert.deepEqual(args.slice(2), ["--paginate", "--slurp"]);
        return JSON.stringify([[], state.release ? [state.release] : []]);
      }
      if (endpoint === "releases/99/assets?per_page=100") {
        assert.deepEqual(args.slice(2), ["--paginate", "--slurp"]);
        behavior.beforeList?.(state);
        // Exercise actual pagination, not only one embedded release.assets page.
        return JSON.stringify([state.assets.slice(0, 7), state.assets.slice(7)]);
      }
      if (/^releases\/assets\/\d+$/.test(endpoint)) {
        const id = Number(endpoint.split("/").at(-1));
        const asset = state.assets.find((entry) => entry.id === id);
        assert(asset, `requested unknown asset ID ${id}`);
        if (args.length === 2) {
          behavior.beforeAssetRead?.(state, asset);
          return JSON.stringify(asset);
        }
        assert.deepEqual(args.slice(2), ["--method", "DELETE"]);
        state.mutations.push(`delete:${id}`);
        if (behavior.deleteFails) throw Object.assign(new Error("delete failed"), { stderr: "gh: Forbidden (HTTP 403)" });
        state.deletedAssets.push({ ...asset });
        if (!behavior.deleteNoEffect) state.assets = state.assets.filter((entry) => entry.id !== id);
        return "";
      }
      if (endpoint === "releases/99") {
        if (args.length === 2) return JSON.stringify(state.release);
        assert.deepEqual(args.slice(2), ["--method", "PATCH", "--field", "draft=false"]);
        state.mutations.push("publish");
        assert.equal(state.assets.length, manifest.length, "publication must be last after all assets");
        for (const entry of manifest) assert.equal(state.assets.find((a) => a.name === entry.name)?.digest, `sha256:${entry.sha256}`);
        if (!behavior.publishFails) state.release.draft = false;
        if (behavior.publishFails || behavior.publishResponseLost) throw new Error("publish response lost");
        return JSON.stringify(state.release);
      }
    }
    if (args[0] === "release" && args[1] === "create") {
      assert.deepEqual(args, ["release", "create", options.tag, "--repo", options.repo,
        "--verify-tag", "--target", options.sha, "--title", `nirs4all Studio ${options.version}`,
        "--notes-file", options.notesPath, "--draft", ...(options.prerelease ? ["--prerelease"] : [])]);
      state.mutations.push("create-draft");
      state.release = { id: 99, tag_name: options.tag, draft: true, prerelease: options.prerelease };
      if (behavior.createResponseLost) throw new Error("create response lost");
      return "created";
    }
    if (args[0] === "release" && args[1] === "upload") {
      const name = path.basename(args[3]);
      assert.deepEqual(args, ["release", "upload", options.tag, path.join(options.releaseRoot, name), "--repo", options.repo]);
      const attempt = (state.attempts.get(name) || 0) + 1;
      state.attempts.set(name, attempt);
      state.mutations.push(`upload:${name}`);
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      await new Promise((resolve) => setImmediate(resolve));
      state.active--;
      if (behavior.uploadFailure && behavior.uploadFailure(name, attempt)) throw new Error("transient upload failure");
      assert(!state.assets.some((asset) => asset.name === name), "never replace an asset");
      const uploaded = state.asset(manifest.find((entry) => entry.name === name));
      state.assets.push(uploaded);
      behavior.afterUpload?.(state, uploaded);
      if (behavior.uploadResponseLost) throw new Error("upload response lost");
      return "uploaded";
    }
    throw new Error(`Unexpected gh command: ${JSON.stringify(args)}`);
  };
  return { state, manifest, dependencies: { gh, sleep: async (ms) => state.waits.push(ms), log: () => {} } };
}

test("creates a draft, uploads exactly one asset at a time and publishes last", async (t) => {
  const options = fixture(t);
  const remote = github(options, { absent: true, annotated: true });
  const result = await publishQualifiedRelease(options, remote.dependencies);
  assert.equal(result.published, true);
  assert.equal(result.assets, 20);
  assert.equal(remote.state.maxActive, 1);
  assert.equal(remote.state.mutations[0], "create-draft");
  assert.equal(remote.state.mutations.at(-1), "publish");
  assert(remote.state.mutations.slice(1, 11).every((name) => name.endsWith(".sha256")));
  assert.equal(remote.state.mutations.length, 22);
});

test("resumes verified draft assets without uploading them again", async (t) => {
  const options = fixture(t);
  const remote = github(options, { draftHidden: true });
  remote.state.assets.push(...remote.manifest.slice(0, 10).map(remote.state.asset));
  await publishQualifiedRelease(options, remote.dependencies);
  assert.equal(remote.state.mutations.length, 11);
  assert.equal(remote.state.mutations.at(-1), "publish");
});

for (const draft of [true, false]) {
  for (const field of ["digest", "state", "size"]) {
    test(`refuses a different existing ${field}, draft=${draft}, before any mutation`, async (t) => {
      const options = fixture(t);
      const remote = github(options);
      remote.state.release.draft = draft;
      const asset = remote.state.asset(remote.manifest.at(-1));
      asset[field] = field === "size" ? 123456 : "different";
      remote.state.assets.push(asset);
      await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
      assert.deepEqual(remote.state.mutations, []);
    });
  }
}

test("retries a transient upload at most three times with bounded backoff", async (t) => {
  const options = fixture(t);
  const remote = github(options, { uploadFailure: (_name, attempt) => attempt < 3 });
  await publishQualifiedRelease(options, remote.dependencies);
  assert([...remote.state.attempts.values()].every((attempts) => attempts === 3));
  assert.deepEqual(remote.state.waits, remote.manifest.flatMap(() => [5000, 10000]));
  assert.equal(remote.state.maxActive, 1);
});

test("exhausted upload retries leave the release private and stop subsequent uploads", async (t) => {
  const options = fixture(t);
  const remote = github(options, { uploadFailure: () => true });
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /after 3 attempts/);
  assert.equal(remote.state.release.draft, true);
  assert.equal(remote.state.mutations.length, 3);
  assert.deepEqual(remote.state.waits, [5000, 10000]);
});

test("reconciles lost create, upload and publish responses without duplicate mutations", async (t) => {
  const options = fixture(t);
  const remote = github(options, { absent: true, createResponseLost: true, uploadResponseLost: true, publishResponseLost: true });
  await publishQualifiedRelease(options, remote.dependencies);
  assert.equal(remote.state.mutations.length, 22);
  assert.deepEqual(remote.state.waits, []);
});

test("refuses unverified upload bytes and never publishes or retries over them", async (t) => {
  const options = fixture(t);
  const remote = github(options, { afterUpload: (_state, asset) => { asset.digest = "sha256:" + "a".repeat(64); } });
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
  assert.equal(remote.state.mutations.length, 1);
  assert.equal(remote.state.release.draft, true);
});

test("detects an existing asset being replaced by another id with the same bytes", async (t) => {
  const options = fixture(t);
  const remote = github(options, { afterUpload: (state) => { state.assets[0].id = 10000; } });
  remote.state.assets.push(remote.state.asset(remote.manifest[0]));
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /identity changed/);
  assert.equal(remote.state.mutations.length, 1);
});

test("detects release replacement while uploading and refuses publication", async (t) => {
  const options = fixture(t);
  const remote = github(options, { afterUpload: (state) => { state.release.id = 101; } });
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Release identity/);
  assert.equal(remote.state.mutations.length, 1);
});

test("a tag moved during uploads is caught again before publication", async (t) => {
  const options = fixture(t);
  const behavior = { afterUpload: () => { behavior.tagSha = "a".repeat(40); } };
  const remote = github(options, behavior);
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /qualified source SHA/);
  assert.equal(remote.state.release.draft, true);
  assert(!remote.state.mutations.includes("publish"));
});

test("a previously verified asset cannot disappear during the upload sequence", async (t) => {
  const options = fixture(t);
  const remote = github(options, { afterUpload: (state) => { state.assets.shift(); } });
  remote.state.assets.push(remote.state.asset(remote.manifest[0]));
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /disappeared/);
  assert.equal(remote.state.mutations.length, 1);
});

test("unexpected and duplicate remote assets prevent all mutations", async (t) => {
  const options = fixture(t);
  for (const kind of ["unexpected", "duplicate"]) {
    const remote = github(options);
    const asset = remote.state.asset(remote.manifest[0]);
    remote.state.assets.push(asset);
    if (kind === "duplicate") remote.state.assets.push({ ...asset, id: 10000 });
    else asset.name = "unqualified-payload.zip";
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Unexpected or duplicate/);
    assert.deepEqual(remote.state.mutations, []);
  }
});

test("an already public release is verified read-only, never filled or overwritten", async (t) => {
  const options = fixture(t);
  const remote = github(options);
  remote.state.release.draft = false;
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /incomplete/);
  assert.deepEqual(remote.state.mutations, []);
  remote.state.assets.push(...remote.manifest.map(remote.state.asset));
  await publishQualifiedRelease(options, remote.dependencies);
  assert.deepEqual(remote.state.mutations, []);
});

test("a moved tag and inaccessible metadata fail before any mutation", async (t) => {
  const options = fixture(t);
  for (const behavior of [{ tagSha: "a".repeat(40) }, { lookupFailure: 403 }]) {
    const remote = github(options, behavior);
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /qualified source SHA|Cannot read/);
    assert.deepEqual(remote.state.mutations, []);
  }
});

test("failed promotion does not claim success or modify payloads", async (t) => {
  const options = fixture(t);
  const remote = github(options, { publishFails: true });
  remote.state.assets.push(...remote.manifest.map(remote.state.asset));
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /still a draft/);
  assert.deepEqual(remote.state.mutations, ["publish"]);
});

test("invalid local bytes, missing sidecars and stable archive skips fail before GitHub", async (t) => {
  const options = fixture(t);
  const dependencies = { gh: async () => assert.fail("must validate locally first"), log: () => {} };
  await assert.rejects(publishQualifiedRelease({ ...options, includeAllInOne: false }, dependencies), /requires every/);
  const file = path.join(options.releaseRoot, expectedPublishedNames(options.version)[0]);
  fs.appendFileSync(file, "changed bytes");
  await assert.rejects(publishQualifiedRelease(options, dependencies), /checksum does not match/);
  fs.unlinkSync(`${file}.sha256`);
  await assert.rejects(publishQualifiedRelease(options, dependencies), /inventory is incomplete/);
});

test("unified workflow invokes the sequential publisher only for immutable tag releases", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, "../../.github/workflows/release-unified.yml"), "utf8"));
  const job = workflow.jobs.release;
  const step = job.steps.find((entry) => entry.run?.includes("scripts/publish-qualified-release.cjs"));
  assert.equal(step.if, "needs.prepare.outputs.is_tag_release == 'true'");
  assert.equal(step.env.RELEASE_SHA, "${{ needs.prepare.outputs.checkout_ref }}");
  assert.equal(step.env.RELEASE_TAG, "${{ needs.prepare.outputs.tag }}");
  assert.equal(step.env.RELEASE_PRERELEASE, "${{ needs.prepare.outputs.prerelease }}");
  assert(!job.steps.some((entry) => entry.uses?.startsWith("softprops/action-gh-release")));
  assert.match(job.if, /needs\.windows-product\.result == 'success'/);
  assert.match(job.if, /needs\.unix-product\.result == 'success'/);
  assert.match(job.if, /needs\.prepare\.outputs\.skip_all_in_one != 'true'/);
});

test("diagnostic preserves HTTP failure while excluding headers, URLs and credential values", () => {
  const error = {
    code: 1,
    stderr: [
      "* Request to https://uploads.example.test/private?token=trace-secret",
      "> Authorization: Bearer header-secret",
      "< X-Request-Id: private-request-id",
      "Set-Cookie: sid=cookie-secret",
      "X-Private:unspaced-header-secret",
      "  folded-header-secret",
      "HTTP/2.0 502 Bad Gateway",
      'HTTP 502: Error saving asset (https://username:url-password@uploads.example.test/releases/123456/assets?name=private&token=query-secret)',
      'error: token=plain-secret password="quoted secret with spaces" username=private-login',
      "error: github_pat_fake_test_token ghp_fake_test_token Bearer bearer-secret Basic basic-secret",
      "error: contact person@example.test, server 192.0.2.10:443, request_id=request-secret",
    ].join("\n"),
  };
  for (const key of ["cmd", "env", "message", "stdout"]) {
    Object.defineProperty(error, key, { get: () => assert.fail(`${key} must never be read`) });
  }
  const result = ghFailureDiagnostic(error);
  assert.match(result, /HTTP 502; exit 1/);
  assert.match(result, /Error saving asset/);
  for (const value of ["header-secret", "private-request-id", "cookie-secret", "unspaced-header-secret",
    "folded-header-secret", "url-password", "uploads.example", "query-secret", "plain-secret",
    "quoted secret", "private-login", "github_pat_", "ghp_", "bearer-secret", "basic-secret",
    "person@example", "192.0.2.10", "request-secret", "Authorization", "Set-Cookie", "X-Private", "123456"]) {
    assert(!result.includes(value), `must redact ${value}`);
  }
});

test("diagnostic keeps useful network and JSON error text without metadata or local identities", () => {
  const error = { stderr: Buffer.from([
    'Post "https://login:password@example.test/path?signature=secret": unexpected EOF',
    '{"message":"Validation Failed","documentation_url":"https://example.test/?private=secret","token":"json-secret","headers":{"X-Internal":"hidden"}}',
    'error: open /home/private-user/release/file.zip: permission denied',
    'error: open C:\\Users\\private-user\\release\\file.zip: permission denied',
    'error: request failed for ?signature=naked-query-secret',
    'error: trace abcdef0123456789abcdef0123456789abcdef0123456789',
  ].join("\n")) };
  const result = ghFailureDiagnostic(error);
  for (const message of ["unexpected EOF", "Validation Failed", "permission denied"]) assert(result.includes(message));
  for (const value of ["example.test", "signature", "json-secret", "headers", "hidden", "private-user", "abcdef0123456789"]) {
    assert(!result.includes(value), `must redact ${value}`);
  }
});

test("diagnostic is bounded and does not fall back to command-bearing errors", () => {
  const result = ghFailureDiagnostic({ stderr: "HTTP 502: " + "Error saving asset. ".repeat(10000) });
  assert(result.length <= 1200);
  assert.match(result, /\[truncated\]$/);
  assert.equal(ghFailureDiagnostic({ message: "Command failed: secret", cmd: "secret", env: { TOKEN: "secret" } }), "no safe stderr detail available");
  const traces = ghFailureDiagnostic({ stderr: "Command failed: gh release upload --token secret\nGH_TOKEN=secret\ngh api --header secret\nenv: secret" });
  assert.equal(traces, "no safe stderr detail available");
});

for (const operation of ["create", "upload", "publish"]) {
  test(`logs a redacted ${operation} error without weakening publication checks`, async (t) => {
    const options = fixture(t);
    const remote = github(options, { absent: operation === "create" });
    const messages = [];
    const originalGh = remote.dependencies.gh;
    let injected = false;
    remote.dependencies.log = (message) => messages.push(message);
    remote.dependencies.gh = async (args) => {
      const response = await originalGh(args);
      const matches = operation === "publish" ? args.includes("PATCH") : args[1] === operation;
      if (matches && !injected) {
        injected = true;
        if (operation === "upload") remote.state.assets.at(-1).state = "starter";
        const error = new Error("Command failed: --token message-secret");
        error.code = 1;
        error.stderr = "HTTP 502: Error saving asset (https://example.test/?token=query-secret)\nAuthorization: Bearer header-secret";
        error.cmd = "gh release --token cmd-secret";
        throw error;
      }
      return response;
    };
    if (operation === "upload") {
      await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
      assert.equal(remote.state.release.draft, true);
      assert.equal(remote.state.mutations.length, 1);
      assert.deepEqual(remote.state.waits, []);
    } else {
      await publishQualifiedRelease(options, remote.dependencies);
      assert.equal(remote.state.mutations.at(-1), "publish");
    }
    assert(injected);
    const logs = messages.join("\n");
    assert.match(logs, /HTTP 502; exit 1/);
    assert.match(logs, /Error saving asset/);
    for (const value of ["message-secret", "cmd-secret", "query-secret", "header-secret", "example.test", "Authorization"]) assert(!logs.includes(value));
  });
}

function failedStarterFixture(t, overrides = {}) {
  const options = fixture(t);
  const failure = Object.assign(new Error("upload failed"), { stderr: "HTTP 500: Error saving asset (https://uploads.example.test/assets?name=private)" });
  const behavior = { afterUpload: (state, asset) => {
    asset.state = "starter";
    asset.digest = null;
    throw failure;
  }, ...overrides };
  const remote = github(options, behavior);
  const target = remote.manifest.find((entry) => entry.name.endsWith("-linux-x64.tar.gz"));
  remote.state.assets.push(...remote.manifest.filter((entry) => entry !== target).map(remote.state.asset));
  const messages = [];
  remote.dependencies.log = (message) => messages.push(message);
  return { options, remote, behavior, target, failure, messages };
}

test("a current HTTP 500 starter is reread by ID, deleted alone and retried successfully", async (t) => {
  const { options, remote, behavior, target, failure, messages } = failedStarterFixture(t);
  behavior.afterUpload = (state, asset) => {
    if (state.attempts.get(asset.name) === 1) {
      asset.state = "starter";
      asset.digest = null;
      throw failure;
    }
  };
  const verifiedBefore = remote.state.assets.map((asset) => ({ ...asset }));
  const result = await publishQualifiedRelease(options, remote.dependencies);
  assert.equal(remote.state.deletedAssets.length, 1);
  const removed = remote.state.deletedAssets[0];
  assert.equal(removed.name, target.name);
  assert.equal(removed.state, "starter");
  assert.equal(removed.digest, null);
  assert.deepEqual(remote.state.mutations, [`upload:${target.name}`, `delete:${removed.id}`, `upload:${target.name}`, "publish"]);
  assert.deepEqual(remote.state.waits, [5000]);
  assert.deepEqual(remote.state.assets.filter((asset) => asset.name !== target.name), verifiedBefore);
  assert.deepEqual(result.cleanedStarters, [{ release_id: 99, asset_id: removed.id, name: target.name, size: target.size,
    state: "starter", digest: null, http_status: 500, attempt: 1, source_sha: options.sha, absent_before_upload: true }]);
  assert(remote.state.calls.some((args) => args.length === 2 && args[1].endsWith(`/releases/assets/${removed.id}`)));
  assert(messages.some((message) => message.startsWith("Removed current failed-upload starter:") && message.includes(`"asset_id":${removed.id}`)));
});

test("three upstream starter failures stay bounded and never publish", async (t) => {
  const { options, remote, target } = failedStarterFixture(t);
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /after 3 attempts/);
  assert.equal(remote.state.attempts.get(target.name), 3);
  assert.equal(remote.state.deletedAssets.length, 3);
  assert.equal(new Set(remote.state.deletedAssets.map((asset) => asset.id)).size, 3);
  assert.deepEqual(remote.state.waits, [5000, 10000]);
  assert.equal(remote.state.release.draft, true);
  assert(!remote.state.mutations.includes("publish"));
});

test("a preexisting starter is never uploaded over or deleted", async (t) => {
  const { options, remote, target } = failedStarterFixture(t);
  remote.state.assets.push({ ...remote.state.asset(target), state: "starter", digest: null });
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
  assert.deepEqual(remote.state.mutations, []);
});

test("a starter appearing during backoff is preexisting for the next attempt and cannot be deleted", async (t) => {
  const { options, remote, target } = failedStarterFixture(t);
  remote.dependencies.sleep = async () => remote.state.assets.push({ ...remote.state.asset(target), state: "starter", digest: null });
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
  assert.equal(remote.state.attempts.get(target.name), 1);
  assert.equal(remote.state.deletedAssets.length, 1);
  assert.equal(remote.state.mutations.length, 2);
});

for (const stderr of ["HTTP 403: Forbidden", "gh: Validation Failed (HTTP 422)", "unexpected EOF", "HTTP/2.0 500 Bad Gateway", "X-Upstream: failed (HTTP 500)\nunexpected EOF",
  "Post https://example.test/?error=HTTP500: unexpected EOF", "HTTP 500: older error\ngh: Forbidden (HTTP 403)"]) {
  test(`a starter without an unambiguous upstream 5xx is protected: ${stderr.split("\n")[0]}`, async (t) => {
    const { options, remote, failure } = failedStarterFixture(t);
    failure.stderr = stderr;
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace/);
    assert.equal(remote.state.mutations.length, 1);
    assert.deepEqual(remote.state.deletedAssets, []);
  });
}

for (const field of ["name", "size", "digest", "state", "id"]) {
  test(`an upstream failure cannot authorize deletion with a different ${field}`, async (t) => {
    const { options, remote, behavior, failure } = failedStarterFixture(t);
    behavior.afterUpload = (_state, asset) => {
      asset.state = "starter";
      asset.digest = null;
      asset[field] = { name: "foreign.zip", size: asset.size + 1, digest: "sha256:" + "c".repeat(64), state: "uploaded", id: -1 }[field];
      throw failure;
    };
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Refusing to replace|Unexpected/);
    assert.equal(remote.state.mutations.length, 1);
    assert.deepEqual(remote.state.deletedAssets, []);
  });
}

for (const field of ["id", "draft", "tag_name", "prerelease"]) {
  test(`cleanup refuses a release whose ${field} changed after upload`, async (t) => {
    const { options, remote, behavior } = failedStarterFixture(t);
    const failUpload = behavior.afterUpload;
    behavior.afterUpload = (state, asset) => {
      state.release[field] = { id: 101, draft: false, tag_name: "0.11.8", prerelease: true }[field];
      failUpload(state, asset);
    };
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Release identity|visibility changed/);
    assert.equal(remote.state.mutations.length, 1);
    assert.deepEqual(remote.state.deletedAssets, []);
  });
}

for (const change of ["disappeared", "replaced", "modified", "starter"]) {
  test(`cleanup refuses when a previously verified asset is ${change}`, async (t) => {
    const { options, remote, behavior } = failedStarterFixture(t);
    const failUpload = behavior.afterUpload;
    behavior.afterUpload = (state, asset) => {
      if (change === "disappeared") state.assets.shift();
      if (change === "replaced") state.assets[0].id = 10000;
      if (change === "modified") state.assets[0].digest = "sha256:" + "c".repeat(64);
      if (change === "starter") { state.assets[0].state = "starter"; state.assets[0].digest = null; }
      failUpload(state, asset);
    };
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /disappeared|identity changed|Refusing to replace/);
    assert.equal(remote.state.mutations.length, 1);
    assert.deepEqual(remote.state.deletedAssets, []);
  });
}

for (const field of ["name", "size", "digest", "state", "id"]) {
  test(`cleanup rereads the asset ID and refuses a changed ${field}`, async (t) => {
    const { options, remote, behavior } = failedStarterFixture(t);
    behavior.beforeAssetRead = (_state, asset) => {
      asset[field] = { name: "foreign.zip", size: asset.size + 1, digest: "sha256:" + "c".repeat(64), state: "uploaded", id: 10000 }[field];
    };
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Starter changed/);
    assert.equal(remote.state.mutations.length, 1);
    assert.deepEqual(remote.state.deletedAssets, []);
  });
}

test("cleanup rechecks release visibility after rereading the starter ID", async (t) => {
  const { options, remote, behavior } = failedStarterFixture(t);
  behavior.beforeAssetRead = (state) => { state.release.draft = false; };
  await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /visibility changed/);
  assert.equal(remote.state.mutations.length, 1);
  assert.deepEqual(remote.state.deletedAssets, []);
});

for (const behavior of [{ deleteFails: true }, { deleteNoEffect: true }]) {
  test(`failed starter cleanup stops retries: ${JSON.stringify(behavior)}`, async (t) => {
    const { options, remote, target } = failedStarterFixture(t, behavior);
    await assert.rejects(publishQualifiedRelease(options, remote.dependencies), /Could not verify starter cleanup|Refusing to replace/);
    assert.equal(remote.state.attempts.get(target.name), 1);
    assert.equal(remote.state.mutations.length, 2);
    assert.equal(remote.state.release.draft, true);
    assert.deepEqual(remote.state.waits, []);
  });
}

test("an uploaded payload with its qualified SHA survives an upstream error without deletion", async (t) => {
  const { options, remote, behavior, failure } = failedStarterFixture(t);
  behavior.afterUpload = () => { throw failure; };
  await publishQualifiedRelease(options, remote.dependencies);
  assert.deepEqual(remote.state.deletedAssets, []);
  assert.equal(remote.state.mutations.length, 2);
  assert.equal(remote.state.mutations.at(-1), "publish");
});
