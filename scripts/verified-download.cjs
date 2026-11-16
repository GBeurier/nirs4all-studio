/** Download build inputs and accept them only when their SHA-256 matches a pinned value. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { configureSystemTrust } = require("./tls-trust.cjs");

const DOWNLOAD_ATTEMPTS = 3;

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

async function fetchResponse(url) {
  configureSystemTrust();
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      // A missing file will not appear on retry.
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Download failed: ${url} (${lastError.cause?.message ?? lastError.message})`);
}

async function fetchText(url) {
  return (await fetchResponse(url)).text();
}

/**
 * Write `url` to `destination` only when its content has the expected SHA-256.
 * An existing file with that digest is kept; any other content is replaced.
 */
async function downloadVerified(url, destination, sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid SHA-256 pin for ${url}`);
  if (fs.existsSync(destination) && sha256File(destination) === sha256) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  try {
    const response = await fetchResponse(url);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
    const actual = sha256File(partial);
    if (actual !== sha256) {
      throw new Error(`SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}`);
    }
    fs.renameSync(partial, destination);
  } finally {
    fs.rmSync(partial, { force: true });
  }
  return destination;
}

module.exports = { downloadVerified, fetchText, sha256File };
