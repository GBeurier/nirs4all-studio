/**
 * Pinned python-build-standalone runtime that Studio installs when it creates
 * an environment. The Electron main process loads this file from the
 * application root; the offline installer payload ships the same archive.
 */

const PYTHON_VERSION = "3.11.13";
const PBS_TAG = "20250828";
const PBS_BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}`;

// SHA-256 values from the release's SHA256SUMS file.
const PYTHON_BUILD_STANDALONE_ARCHIVES = Object.freeze({
  "win32-x64": Object.freeze({
    filename: `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    sha256: "cf4a2da81ddd38b31d28eec10fe5fa844641d790124f889f1db92ae755a78a56",
  }),
  "linux-x64": Object.freeze({
    filename: `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    sha256: "1a6f32ef5ae2358c4707d3f979478b7678c9841fce42e26c44cfbc5f5e1133a2",
  }),
  "darwin-arm64": Object.freeze({
    filename: `cpython-${PYTHON_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz`,
    sha256: "58066d3516e1376a85d2533c43929b9404fac8ef9a7bf023a1ee30ab24c768a8",
  }),
});

function listSupportedPlatformArchKeys() {
  return Object.keys(PYTHON_BUILD_STANDALONE_ARCHIVES).sort();
}

function getArchive(platform, arch) {
  const archive = PYTHON_BUILD_STANDALONE_ARCHIVES[`${platform}-${arch}`];
  if (!archive) {
    throw new Error(
      `Unsupported python-build-standalone target '${platform}-${arch}'. Supported: ${listSupportedPlatformArchKeys().join(", ")}`,
    );
  }
  return archive;
}

function getArchiveFilename(platform, arch) {
  return getArchive(platform, arch).filename;
}

function getArchiveSha256(platform, arch) {
  return getArchive(platform, arch).sha256;
}

function getDownloadUrl(platform, arch) {
  return `${PBS_BASE_URL}/${getArchiveFilename(platform, arch)}`;
}

module.exports = {
  PYTHON_VERSION,
  getArchiveFilename,
  getArchiveSha256,
  getDownloadUrl,
  listSupportedPlatformArchKeys,
};
