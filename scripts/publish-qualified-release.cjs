const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify, stripVTControlCharacters } = require("node:util");
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

function ghFailureDiagnostic(error) {
  // Never use error.message, cmd, stdout or env: execFile includes the command
  // and its arguments in message. Limit input work as well as the emitted log.
  const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 65536)
    : Buffer.isBuffer(error?.stderr) ? error.stderr.subarray(0, 65536).toString("utf8") : "";
  const clean = stripVTControlCharacters(stderr)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const status = [...clean.matchAll(/\bHTTP(?:\/[\d.]+)?[ :]+([45]\d{2})\b/gi)].at(-1)?.[1];
  const details = [];
  if (status) details.push(`HTTP ${status}`);
  if (Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255) details.push(`exit ${error.code}`);
  const messages = [];
  for (const raw of clean.split(/\r?\n/)) {
    let line = raw.trim();
    // Drop all HTTP headers and debug/command traces, including folded lines.
    if (!line || /^[<>*]/.test(line) || /^[ \t]+/.test(raw) ||
      /^(?!gh:|error:|fatal:)[\w-]+:/i.test(line) ||
      /\b(?:command|cmd|environment|env)\s*(?:failed\b|[=:])/i.test(line) ||
      /\bgh\s+(?:api|release|auth)\b/i.test(line) || /^[A-Z_][A-Z0-9_]*=/.test(line)) continue;
    if (/^(?:gh:\s*)?[{[]/.test(line)) {
      try {
        // JSON error bodies may include arbitrary metadata: retain only message.
        const body = JSON.parse(line.replace(/^gh:\s*/, ""));
        line = typeof body.message === "string" ? body.message : "";
      } catch { continue; }
    }
    line = line
      .replace(/(?:^|[\r\n])\s*(?!gh:|error:|fatal:)[\w-]+:[^\r\n]*/gi, "")
      .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g, "[URL redacted]")
      .replace(/\?[^\s"'<>]+/g, "[query redacted]")
      .replace(/\b(?:Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]+/gi, "[credential redacted]")
      .replace(/["']?\b(?:[\w-]*(?:token|secret|password|passwd|credential|authorization|cookie|client[_-]?id|user[_-]?id|request[_-]?id|session[_-]?id)|username|login)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "[credential redacted]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[token redacted]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[identity redacted]")
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[address redacted]")
      .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|private|var|runner|__w)\/)[^\s"'<>]+/g, "[path redacted]")
      .replace(/[A-Za-z0-9_+/.=-]{24,}/g, "[identifier redacted]")
      .replace(/\b\d{6,}\b/g, "[identifier redacted]")
      .replace(/\s+/g, " ").trim();
    if (line) messages.push(line);
  }
  if (messages.length) details.push(`stderr: ${messages.join(" | ")}`);
  const result = details.join("; ") || "no safe stderr detail available";
  return result.length > 1200 ? `${result.slice(0, 1186)} [truncated]` : result;
}

function ghFailureHttpStatus(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 65536)
    : Buffer.isBuffer(error?.stderr) ? error.stderr.subarray(0, 65536).toString("utf8") : "";
  // Require an explicit gh error status, not a debug response header, exit code,
  // timeout or status mentioned inside a URL. Ambiguous responses fail closed.
  const statuses = [...stripVTControlCharacters(stderr).matchAll(/^(?:gh:\s*)?HTTP ([45]\d{2}):|^gh: [^\r\n]*\(HTTP ([45]\d{2})\)\s*$/gm)]
    .map((match) => Number(match[1] || match[2]));
  return new Set(statuses).size === 1 ? statuses[0] : null;
}

function releaseManifest(root, version, channel = null) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Release root must be a real directory");
  }
  const payloads = expectedPublishedNames(version, channel);
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
  const { repo, tag, version, sha, prerelease, releaseRoot, notesPath } = options;
  const channel = options.channel ?? null;
  const incremental = channel !== null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "")) {
    throw new Error("GH_REPO must be an owner/repository pair");
  }
  if (!/^[0-9a-f]{40}$/.test(sha || "") || tag !== version) {
    throw new Error("Release tag/version and full immutable RELEASE_SHA are required");
  }
  if (typeof prerelease !== "boolean") {
    throw new Error("An explicit prerelease flag is required");
  }
  const manifest = options.prepareOnly ? [] : releaseManifest(path.resolve(releaseRoot), version, channel);
  if (options.prepareOnly && incremental) throw new Error("Draft preparation cannot publish a channel");
  const otherChannelNames = new Set(expectedPublishedNames(version)
    .flatMap((name) => [name, `${name}.sha256`]));
  let reviewedNotes;
  if (options.reviewedNotesSha256 !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(options.reviewedNotesSha256)) throw new Error("Invalid reviewed notes SHA256");
    // Optional strict promotion contract; other release callers retain their API.
    const bytes = fs.readFileSync(notesPath);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== options.reviewedNotesSha256) {
      throw new Error("Local release notes do not match review");
    }
    reviewedNotes = bytes.toString("utf8");
    if (!Buffer.from(reviewedNotes, "utf8").equals(bytes)) throw new Error("Reviewed notes must be valid UTF-8");
  }
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
        if (incremental || options.prepareOnly) throw Object.assign(new Error("Use complete release inventory"), { notFound: true });
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
    if (reviewedNotes !== undefined && release.body !== reviewedNotes) {
      throw new Error("Remote release notes do not match review");
    }
  };

  await assertTag();
  let release = await lookupRelease();
  if (!release && incremental) throw new Error("Installer channels require the single prepared release draft");
  if (!release) {
    // The tag was already verified above. An older --target SHA whose workflows
    // differ from main requires workflows:write, which GITHUB_TOKEN cannot have.
    // Omit target_commitish so GitHub resolves the default branch for permission
    // checks while the existing immutable tag still determines application code.
    const args = ["release", "create", tag, "--repo", repo, "--verify-tag",
      "--title", `nirs4all Studio ${version}`,
      "--notes-file", path.resolve(notesPath), "--draft"];
    if (prerelease) args.push("--prerelease");
    try {
      await gh(args);
    } catch (error) {
      // The response may have been lost after creation. Reconcile by immutable tag.
      log(`Draft creation did not return success (${ghFailureDiagnostic(error)}); checking its identity before continuing.`);
    }
    // GitHub can acknowledge draft creation before its by-tag and list APIs
    // expose it. Reconcile the same immutable tag with bounded backoff.
    for (let attempt = 0; attempt < 6 && !release; attempt++) {
      if (attempt) await wait(2000);
      release = await lookupRelease();
    }
    if (!release) throw new Error("Could not create the release draft");
  }
  assertRelease(release);
  if (options.prepareOnly) {
    await assertTag();
    return { releaseId: release.id, tag, sha, prepared: true, draft: release.draft };
  }
  const releaseId = release.id;
  pinnedReleaseId = releaseId;
  const wasDraft = release.draft;
  const identities = new Map();
  const cleanedStarters = [];
  const expected = new Map(manifest.map((entry) => [entry.name, entry]));

  const isCurrentStarter = (asset, entry) => asset &&
    Number.isSafeInteger(asset.id) && asset.id > 0 && asset.name === entry.name &&
    asset.state === "starter" && asset.digest === null && asset.size === entry.size &&
    !identities.has(entry.name) && ![...identities.values()].includes(asset.id);

  const inspect = async (requireComplete = false, expectedDraft = wasDraft, currentAttempt = null) => {
    const current = await lookupRelease();
    assertRelease(current, releaseId);
    // Independent channels can finish while this one uploads. Only an explicit
    // channel invocation may append to a published release; full promotion
    // retains its original atomic draft/public inventory contract.
    if (!incremental && current.draft !== expectedDraft) throw new Error("Release visibility changed during upload");
    const pages = await api(`releases/${releaseId}/assets?per_page=100`, ["--paginate", "--slurp"]);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new Error("Malformed release asset inventory");
    }
    const present = new Map();
    const assetIds = new Set();
    const assetNames = new Set();
    for (const asset of pages.flat()) {
      const entry = expected.get(asset.name);
      if ((!entry && !(incremental && otherChannelNames.has(asset.name))) ||
        assetNames.has(asset.name) || assetIds.has(asset.id) ||
        !Number.isSafeInteger(asset.id) || asset.id <= 0) throw new Error(`Unexpected or duplicate release asset: ${asset.name}`);
      assetNames.add(asset.name);
      assetIds.add(asset.id);
      // Other channels are preserved, not assessed or claimed by this call.
      if (!entry) continue;
      present.set(asset.name, asset);
      if (currentAttempt && asset.name === currentAttempt.name && isCurrentStarter(asset, currentAttempt)) continue;
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

  const removeCurrentStarter = async (entry, starter, attempt, httpStatus) => {
    // GitHub documents incomplete starter remnants after upstream upload errors:
    // https://docs.github.com/en/rest/releases/assets#upload-a-release-asset
    // This exception never applies to an asset present before our failed attempt.
    await assertTag();
    const reread = await api(`releases/assets/${starter.id}`);
    if (reread.id !== starter.id || !isCurrentStarter(reread, entry)) {
      throw new Error(`Starter changed before cleanup; deletion refused: ${entry.name}`);
    }
    const current = (await inspect(false, true, entry)).get(entry.name);
    if (!current || current.id !== starter.id || !isCurrentStarter(current, entry)) {
      throw new Error(`Starter changed before cleanup; deletion refused: ${entry.name}`);
    }
    const beforeDelete = await lookupRelease();
    assertRelease(beforeDelete, releaseId);
    if (!beforeDelete.draft && !incremental) throw new Error("Release became public; starter deletion refused");
    const proof = {
      release_id: releaseId, asset_id: starter.id, name: entry.name, size: entry.size,
      state: "starter", digest: null, http_status: httpStatus, attempt,
      source_sha: sha, absent_before_upload: true,
    };
    log(`Removing current failed-upload starter: ${JSON.stringify(proof)}`);
    try {
      // DELETE returns 204 with no JSON body. Never use gh release delete-asset,
      // which resolves by name and could delete a replacement with another ID.
      await gh(["api", `${apiRoot}/releases/assets/${starter.id}`, "--method", "DELETE"]);
    } catch (error) {
      log(`Starter cleanup did not return success (${ghFailureDiagnostic(error)}).`);
      throw new Error(`Could not verify starter cleanup: ${entry.name}`);
    }
    cleanedStarters.push(proof);
    log(`Removed current failed-upload starter: ${JSON.stringify(proof)}`);
    return inspect();
  };

  // Full-release invocations keep public releases read-only. An explicit
  // channel may add only its missing, qualified pair, never replace an asset.
  let present = await inspect(!wasDraft && !incremental);
  if (wasDraft || incremental) {
    for (const entry of manifest) {
      if (present.has(entry.name)) continue;
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Renew the absence proof after any backoff; a preexisting starter is
        // rejected here, before this attempt has authority to remove anything.
        present = await inspect();
        if (present.has(entry.name)) break;
        const absentBeforeUpload = !identities.has(entry.name);
        if (sha256File(entry.file) !== entry.sha256) {
          throw new Error(`Local qualified asset changed: ${entry.name}`);
        }
        log(`Uploading ${entry.name} (attempt ${attempt}/3)`);
        let httpStatus = null;
        try {
          if (incremental) {
            // Address the verified release id, never an ambiguous draft by tag.
            await gh(["api", `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(entry.name)}`,
              "--method", "POST", "--header", "Content-Type: application/octet-stream", "--input", entry.file]);
          } else {
            await gh(["release", "upload", tag, entry.file, "--repo", repo]);
          }
        } catch (error) {
          httpStatus = ghFailureHttpStatus(error);
          // A failed response may still have stored the complete asset. Never clobber it.
          log(`Upload did not return success for ${entry.name} (${ghFailureDiagnostic(error)}); verifying remote state.`);
        }
        const mayRemoveStarter = absentBeforeUpload && httpStatus >= 500 && httpStatus <= 599;
        present = await inspect(false, true, mayRemoveStarter ? entry : null);
        const starter = present.get(entry.name);
        if (mayRemoveStarter && starter?.state === "starter") {
          present = await removeCurrentStarter(entry, starter, attempt, httpStatus);
        }
        if (present.has(entry.name)) break;
        if (attempt === 3) throw new Error(`Upload failed after 3 attempts: ${entry.name}`);
        await wait(attempt * 5000);
      }
    }
  }

  await assertTag();
  await inspect(true);
  if (wasDraft) {
    // No verified payload is ever replaced or deleted. A later independent
    // channel can append its own qualified files to this immutable source tag.
    try {
      const fields = ["--method", "PATCH", "--field", "draft=false"];
      // Bind the reviewed body in the same PATCH that makes the draft public,
      // closing the reread-to-publication window for a concurrent notes change.
      if (reviewedNotes !== undefined) fields.push("--raw-field", `body=${reviewedNotes}`);
      await api(`releases/${releaseId}`, fields);
    } catch (error) {
      // Publication can also succeed before a lost response; verify rather than retry blindly.
      log(`Publication did not return success (${ghFailureDiagnostic(error)}); checking final release visibility.`);
    }
    release = await lookupRelease();
    assertRelease(release, releaseId);
    if (release.draft) throw new Error("All assets are verified but the release is still a draft");
    await inspect(true, false);
  }
  log(`Verified published ${channel || "release"} ${tag}: ${manifest.length} assets, source ${sha}`);
  return { releaseId, tag, sha, assets: manifest.length, published: true, cleanedStarters,
    ...(incremental ? { channel, otherChannelsAssessed: false } : {}) };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length < 2 || argv.length > 3 || !["true", "false"].includes(env.RELEASE_PRERELEASE)) {
    throw new Error("Usage: node scripts/publish-qualified-release.cjs <release-root> <version> [channel]; set GH_REPO, RELEASE_TAG, RELEASE_SHA, RELEASE_PRERELEASE, RELEASE_NOTES_PATH and GH_TOKEN");
  }
  return publishQualifiedRelease({
    repo: env.GH_REPO || env.GITHUB_REPOSITORY,
    tag: env.RELEASE_TAG,
    sha: env.RELEASE_SHA,
    prerelease: env.RELEASE_PRERELEASE === "true",
    releaseRoot: argv[0],
    version: argv[1],
    notesPath: env.RELEASE_NOTES_PATH || "release_notes.md",
    channel: argv[2] ?? null,
  });
}

if (require.main === module) {
  main().catch((error) => {
    // Do not emit child-process errors: they may include credential-bearing diagnostics.
    console.error(error.cmd ? "GitHub release operation failed" : error.message);
    process.exitCode = 1;
  });
}

module.exports = { ghFailureDiagnostic, main, publishQualifiedRelease, releaseManifest };
