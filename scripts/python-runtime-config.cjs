const recommendedConfig = require("../recommended-config.json");

const PYTHON_VERSION = "3.11.13";
const PYTHON_VERSION_MM = PYTHON_VERSION.split(".").slice(0, 2).join(".");
const PBS_TAG = "20250828";
const PBS_BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}`;

const PYTHON_BUILD_STANDALONE_ARCHIVES = Object.freeze({
  win32: Object.freeze({
    x64: `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  }),
  linux: Object.freeze({
    x64: `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  }),
  darwin: Object.freeze({
    x64: `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-apple-darwin-install_only.tar.gz`,
    arm64: `cpython-${PYTHON_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz`,
  }),
});

const BACKEND_COMMON_PACKAGES = Object.freeze([
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.34.0",
  "pydantic>=2.10.0",
  "python-multipart>=0.0.20",
  "httpx>=0.27.0",
  "pyyaml>=6.0",
  "packaging>=24.0",
  "platformdirs>=4.0.0",
  "sentry-sdk[fastapi]>=2.0.0",
]);

const LEGACY_FLAVOR_TO_PROFILE = Object.freeze({
  cpu: "cpu",
  gpu: "gpu-cuda-torch",
  "gpu-metal": "gpu-mps",
});

const STANDALONE_V1_PROFILE = "cpu";

const PROFILE_OPTIONAL_PACKAGES = Object.freeze({
  cpu: Object.freeze(["xgboost", "lightgbm", "trendfitter", "pyopls", "shap", "umap-learn"]),
  "gpu-cuda-torch": Object.freeze([]),
  "gpu-mps": Object.freeze([]),
});

function clonePackageSpec(spec) {
  if (typeof spec === "string") {
    return Object.freeze({
      min: spec,
      recommended: null,
    });
  }
  if (!spec || typeof spec !== "object") {
    throw new Error(`Invalid package spec: ${String(spec)}`);
  }
  return Object.freeze({
    min: typeof spec.min === "string" ? spec.min : "",
    recommended: typeof spec.recommended === "string" ? spec.recommended : null,
  });
}

function stringifyPackageSpec(packageName, spec, options = {}) {
  const normalized = clonePackageSpec(spec);
  if (options.preferRecommended && normalized.recommended) {
    return `${packageName}==${normalized.recommended}`;
  }
  if (normalized.min) {
    return `${packageName}${normalized.min}`;
  }
  if (normalized.recommended) {
    return `${packageName}==${normalized.recommended}`;
  }
  return packageName;
}

function getOptionalPackageSpec(packageName) {
  const spec = recommendedConfig.optional?.[packageName];
  if (!spec) {
    throw new Error(`Unknown optional runtime package '${packageName}'`);
  }
  return clonePackageSpec(spec);
}

function buildProductProfiles() {
  const rawProfiles = recommendedConfig.profiles ?? {};
  return Object.freeze(
    Object.fromEntries(
      Object.entries(rawProfiles).map(([profileId, rawProfile]) => {
        const basePackageSpecs = Object.freeze(
          Object.fromEntries(
            Object.entries(rawProfile.packages ?? {}).map(([packageName, spec]) => [packageName, clonePackageSpec(spec)]),
          ),
        );
        const extraPackageNames = Object.freeze([...(PROFILE_OPTIONAL_PACKAGES[profileId] ?? [])]);
        const extraPackageSpecs = Object.freeze(
          Object.fromEntries(extraPackageNames.map((packageName) => [packageName, getOptionalPackageSpec(packageName)])),
        );
        const packageSpecs = Object.freeze({
          ...basePackageSpecs,
          ...extraPackageSpecs,
        });

        return [profileId, Object.freeze({
          id: profileId,
          label: rawProfile.label ?? profileId,
          description: rawProfile.description ?? "",
          platforms: Object.freeze([...(rawProfile.platforms ?? [])]),
          basePackageSpecs,
          extraPackageNames,
          extraPackageSpecs,
          packageSpecs,
          packageInstallSpecs: Object.freeze(
            Object.entries(packageSpecs).map(([packageName, spec]) => stringifyPackageSpec(packageName, spec)),
          ),
        })];
      }),
    ),
  );
}

const PRODUCT_PROFILES = buildProductProfiles();

function listSupportedPlatformArchKeys() {
  return Object.entries(PYTHON_BUILD_STANDALONE_ARCHIVES)
    .flatMap(([platform, archMap]) => Object.keys(archMap).map((arch) => `${platform}-${arch}`))
    .sort();
}

function getArchiveFilename(platform, arch) {
  const archiveName = PYTHON_BUILD_STANDALONE_ARCHIVES[platform]?.[arch];
  if (!archiveName) {
    throw new Error(
      `Unsupported python-build-standalone target '${platform}-${arch}'. Supported: ${listSupportedPlatformArchKeys().join(", ")}`,
    );
  }
  return archiveName;
}

function getDownloadUrl(platform, arch) {
  return `${PBS_BASE_URL}/${getArchiveFilename(platform, arch)}`;
}

function getProductProfile(profileId) {
  const profile = PRODUCT_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown product profile '${profileId}'`);
  }
  return profile;
}

function isProfileSupportedOnPlatform(profileId, platform = process.platform) {
  const profile = getProductProfile(profileId);
  return profile.platforms.length === 0 || profile.platforms.includes(platform);
}

function assertProfileSupportedOnPlatform(profileId, platform = process.platform) {
  const profile = getProductProfile(profileId);
  if (!isProfileSupportedOnPlatform(profileId, platform)) {
    throw new Error(
      `Product profile '${profileId}' is not supported on platform '${platform}'. Supported platforms: ${profile.platforms.join(", ")}`,
    );
  }
  return profile;
}

function getProfilePackageSpecs(profileId, options = {}) {
  const profile = getProductProfile(profileId);
  return options.includeExtraPackages === false ? profile.basePackageSpecs : profile.packageSpecs;
}

function getProfilePackageInstallSpecs(profileId, options = {}) {
  const packageSpecs = getProfilePackageSpecs(profileId, options);
  const allowedPackages = options.packageNames ? new Set(options.packageNames) : null;
  const omittedPackages = new Set(options.omitPackages ?? []);

  return Object.freeze(
    Object.entries(packageSpecs)
      .filter(([packageName]) => (!allowedPackages || allowedPackages.has(packageName)) && !omittedPackages.has(packageName))
      .map(([packageName, spec]) => stringifyPackageSpec(packageName, spec, {
        preferRecommended: options.preferRecommended,
      })),
  );
}

function resolveProfileForFlavor(flavor, platform = process.platform) {
  const normalizedFlavor = String(flavor).trim();
  const profileFromFlavor = LEGACY_FLAVOR_TO_PROFILE[normalizedFlavor];
  if (!profileFromFlavor) {
    throw new Error(
      `Invalid flavor '${normalizedFlavor}'. Must be one of: ${Object.keys(LEGACY_FLAVOR_TO_PROFILE).join(", ")}`,
    );
  }
  if (platform === "darwin" && normalizedFlavor === "gpu") {
    return "gpu-mps";
  }
  assertProfileSupportedOnPlatform(profileFromFlavor, platform);
  return profileFromFlavor;
}

const MANAGED_RUNTIME_PACKAGES = Object.freeze([
  ...BACKEND_COMMON_PACKAGES,
  ...getProfilePackageInstallSpecs(STANDALONE_V1_PROFILE, {
    includeExtraPackages: false,
    packageNames: ["nirs4all"],
  }),
]);

module.exports = {
  assertProfileSupportedOnPlatform,
  BACKEND_COMMON_PACKAGES,
  LEGACY_FLAVOR_TO_PROFILE,
  MANAGED_RUNTIME_PACKAGES,
  PBS_BASE_URL,
  PBS_TAG,
  PRODUCT_PROFILES,
  PROFILE_OPTIONAL_PACKAGES,
  PYTHON_BUILD_STANDALONE_ARCHIVES,
  PYTHON_VERSION,
  PYTHON_VERSION_MM,
  STANDALONE_V1_PROFILE,
  getArchiveFilename,
  getDownloadUrl,
  getProductProfile,
  getProfilePackageInstallSpecs,
  getProfilePackageSpecs,
  isProfileSupportedOnPlatform,
  listSupportedPlatformArchKeys,
  resolveProfileForFlavor,
};
