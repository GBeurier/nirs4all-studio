const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: sleep } = require("node:timers/promises");
const {
  expectedPublishedNames,
  parseChecksumSidecar,
  sha256File,
} = require("./finalize-release-assets.cjs");

const execFileAsync = promisify(execFile);

async function runGh(args) {
  // Capture output: failed uploads must not print tokens, headers or payloads.
  return (await execFileAsync("gh", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  })).stdout;
}

function releaseManifest(root, version, includeAllInOne) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Release root must be a real directory");
  }
  const payloads = expectedPublishedNames(version, includeAllInOne);
  const expected = payloads.flatMap((name) => [name, `${name}.sha256`]).sort();
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(expected)) {
    throw new Error("Release asset inventory is incomplete or contains unexpected files");
  }
  const manifest = [];
  for (const name of payloads) {
    const file = path.join(root, name);
    const sha256 = sha256File(file);
    if (parseChecksumSidecar(`${file}.sha256`, name) !== sha256) {
      throw new Error(`Release checksum does not match payload: ${name}`);
    }
    manifest.push({ name, file, sha256, size: fs.statSync(file).size });
    manifest.push({
      name: `${name}.sha256`,
      file: `${file}.sha256`,
      sha256: sha256File(`${file}.sha256`),
      size: fs.statSync(`${file}.sha256`).size,
    });
  }
  // Sidecars first; each invocation of gh uploads exactly one file.
  return manifest.sort((a, b) =>
    Number(b.name.endsWith(".sha256")) - Number(a.name.endsWith(".sha256")) ||
    a.name.localeCompare(b.name));
}

async function publishQualifiedRelease(options, dependencies = {}) {
  const gh = dependencies.gh || runGh;
  const wait = dependencies.sleep || sleep;
  const log = dependencies.log || ((message) => console.log(message));
  const { repo, tag, version, sha, prerelease, includeAllInOne, releaseRoot, notesPath } = options;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "")) {
    throw new Error("GH_REPO must be an owner/repository pair");
  }
  if (!/^[0-9a-f]{40}$/.test(sha || "") || tag !== version) {
    throw new Error("Release tag/version and full immutable RELEASE_SHA are required");
  }
  if (typeof prerelease !== "boolean" || typeof includeAllInOne !== "boolean") {
    throw new Error("Explicit prerelease and archive inclusion flags are required");
  }
  if (!prerelease && !includeAllInOne) {
    throw new Error("A stable release requires every qualified all-in-one archive");
  }
  const manifest = releaseManifest(path.resolve(releaseRoot), version, includeAllInOne);
  const apiRoot = `repos/${repo}`;
  const api = async (endpoint, args = []) => {
    try {
      return JSON.parse(await gh(["api", `${apiRoot}/${endpoint}`, ...args]));
    } catch (error) {
      // Only an explicit GitHub 404 can mean an absent draft. Other errors fail closed.
      if (/\(HTTP 404\)/.test(String(error.stderr || ""))) error.notFound = true;
      throw error;
    }
  };
  const assertTag = async () => {
    let object = (await api(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
    for (let depth = 0; object?.type === "tag" && depth < 5; depth++) {
      if (!/^[0-9a-f]{40}$/.test(object.sha)) throw new Error("Malformed annotated release tag");
      object = (await api(`git/tags/${object.sha}`)).object;
    }
    if (object?.type !== "commit" || object.sha !== sha) {
      throw new Error("Release tag no longer points to the qualified source SHA");
    }
  };
  let pinnedReleaseId;
  const lookupRelease = async () => {
    try {
      if (pinnedReleaseId !== undefined) return await api(`releases/${pinnedReleaseId}`);
      try {
        return await api(`releases/tags/${encodeURIComponent(tag)}`);
      } catch (error) {
        if (!error.notFound) throw error;
        // GitHub's by-tag endpoint may omit drafts. The authenticated list includes them.
        const pages = await api("releases?per_page=100", ["--paginate", "--slurp"]);
        if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
          throw new Error("Malformed release inventory");
        }
        const matches = pages.flat().filter((entry) => entry.tag_name === tag);
        if (matches.length > 1) throw new Error("Ambiguous release tag");
        return matches[0] || null;
      }
    } catch {
      throw new Error("Cannot read GitHub release metadata");
    }
  };
  const assertRelease = (release, expectedId) => {
    if (!release || !Number.isSafeInteger(release.id) || release.id <= 0 ||
      (expectedId !== undefined && release.id !== expectedId) ||
      release.tag_name !== tag || release.prerelease !== prerelease ||
      typeof release.draft !== "boolean") {
      throw new Error("Release identity, tag or prerelease status changed");
    }
  };

  await assertTag();
  let release = await lookupRelease();
  if (!release) {
    const args = ["release", "create", tag, "--repo", repo, "--verify-tag",
      "--target", sha, "--title", `nirs4all Studio ${version}`,
      "--notes-file", path.resolve(notesPath), "--draft"];
    if (prerelease) args.push("--prerelease");
    try {
      await gh(args);
    } catch {
      // The response may have been lost after creation. Reconcile by immutable tag.
      log("Draft creation did not return success; checking its identity before continuing.");
    }
    release = await lookupRelease();
    if (!release) throw new Error("Could not create the release draft");
  }
  assertRelease(release);
  const releaseId = release.id;
  pinnedReleaseId = releaseId;
  const wasDraft = release.draft;
  const identities = new Map();
  const expected = new Map(manifest.map((entry) => [entry.name, entry]));

  const inspect = async (requireComplete = false, expectedDraft = wasDraft) => {
    const current = await lookupRelease();
    assertRelease(current, releaseId);
    if (current.draft !== expectedDraft) throw new Error("Release visibility changed during upload");
    const pages = await api(`releases/${releaseId}/assets?per_page=100`, ["--paginate", "--slurp"]);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new Error("Malformed release asset inventory");
    }
    const present = new Set();
    for (const asset of pages.flat()) {
      const entry = expected.get(asset.name);
      if (!entry || present.has(asset.name)) throw new Error(`Unexpected or duplicate release asset: ${asset.name}`);
      present.add(asset.name);
      if (!Number.isSafeInteger(asset.id) || asset.id <= 0 ||
        asset.state !== "uploaded" || asset.size !== entry.size ||
        asset.digest !== `sha256:${entry.sha256}`) {
        throw new Error(`Refusing to replace unverified or different asset: ${asset.name}`);
      }
      if (identities.has(asset.name) && identities.get(asset.name) !== asset.id) {
        throw new Error(`Release asset identity changed: ${asset.name}`);
      }
      identities.set(asset.name, asset.id);
    }
    for (const name of identities.keys()) {
      if (!present.has(name)) throw new Error(`Previously verified release asset disappeared: ${name}`);
    }
    if (requireComplete && present.size !== manifest.length) {
      throw new Error("Release asset inventory is incomplete; publication refused");
    }
    return present;
  };

  // Check every existing asset before making any upload. Public releases are read-only.
  let present = await inspect(!wasDraft);
  if (wasDraft) {
    for (const entry of manifest) {
      if (present.has(entry.name)) continue;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (sha256File(entry.file) !== entry.sha256) {
          throw new Error(`Local qualified asset changed: ${entry.name}`);
        }
        log(`Uploading ${entry.name} (attempt ${attempt}/3)`);
        try {
          await gh(["release", "upload", tag, entry.file, "--repo", repo]);
        } catch {
          // A failed response may still have stored the complete asset. Never clobber it.
          log(`Upload did not return success for ${entry.name}; verifying remote state.`);
        }
        present = await inspect();
        if (present.has(entry.name)) break;
        if (attempt === 3) throw new Error(`Upload failed after 3 attempts: ${entry.name}`);
        await wait(attempt * 5000);
      }
    }
  }

  await assertTag();
  await inspect(true);
  if (wasDraft) {
    // This must be the final mutation: no payload is ever replaced or deleted.
    try {
      await api(`releases/${releaseId}`, ["--method", "PATCH", "--field", "draft=false"]);
    } catch {
      // Publication can also succeed before a lost response; verify rather than retry blindly.
      log("Publication did not return success; checking final release visibility.");
    }
    release = await lookupRelease();
    assertRelease(release, releaseId);
    if (release.draft) throw new Error("All assets are verified but the release is still a draft");
    await inspect(true, false);
  }
  log(`Verified published release ${tag}: ${manifest.length} assets, source ${sha}`);
  return { releaseId, tag, sha, assets: manifest.length, published: true };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 3 || !["true", "false"].includes(argv[2]) ||
    !["true", "false"].includes(env.RELEASE_PRERELEASE)) {
    throw new Error("Usage: node scripts/publish-qualified-release.cjs <release-root> <version> <include-all-in-one:true|false>; set GH_REPO, RELEASE_TAG, RELEASE_SHA, RELEASE_PRERELEASE, RELEASE_NOTES_PATH and GH_TOKEN");
  }
  return publishQualifiedRelease({
    repo: env.GH_REPO || env.GITHUB_REPOSITORY,
    tag: env.RELEASE_TAG,
    sha: env.RELEASE_SHA,
    prerelease: env.RELEASE_PRERELEASE === "true",
    includeAllInOne: argv[2] === "true",
    releaseRoot: argv[0],
    version: argv[1],
    notesPath: env.RELEASE_NOTES_PATH || "release_notes.md",
  });
}

if (require.main === module) {
  main().catch((error) => {
    // Do not emit child-process errors: they may include credential-bearing diagnostics.
    console.error(error.cmd ? "GitHub release operation failed" : error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, publishQualifiedRelease, releaseManifest };
