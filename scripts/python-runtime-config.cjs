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

// The managed runtime is a bounded Rust -> Python stdio plugin host. Keep its
// package list exact and intentionally small: Python HTTP/control-plane
// dependencies live in python-http-runtime-config.cjs, which is source/dev only.
const PLUGIN_DISTRIBUTION_VERSION = "0.10.3";
const PLUGIN_HOST_PACKAGES = Object.freeze([
  `nirs4all==${PLUGIN_DISTRIBUTION_VERSION}`,
]);

const LEGACY_FLAVOR_TO_PROFILE = Object.freeze({
  cpu: "cpu",
  "cpu-lite": "cpu-lite",
  gpu: "gpu-cuda-torch",
  "gpu-metal": "gpu-mps",
});

const STANDALONE_V1_PROFILE = "cpu";

// The "lite" (pure scikit-learn CPU) profile must never pull heavy ML frameworks,
// including default-install optionals like torch. It also drops umap-learn, whose
// numba + llvmlite + pynndescent stack adds ~170 MB. These names are stripped from
// the lite profile's auto-installed optionals (see PROFILE_OPTIONAL_PACKAGES below).
//
// The exclusion list and the CUDA-wheel renames are data on the cpu-lite profile in
// recommended-config.json (`exclude_optionals` / `package_renames`) — the single
// source of truth shared with api/recommended_config.py, which applies the same
// rules to the interactive installer (/config/align and the setup wizard).
const LITE_PROFILE = "cpu-lite";
const LITE_PROFILE_RAW = recommendedConfig.profiles?.[LITE_PROFILE] ?? {};
const LITE_EXCLUDED_PACKAGE_NAMES = Object.freeze([...(LITE_PROFILE_RAW.exclude_optionals ?? [])]);

// Lite also swaps CUDA-enabled wheels for their official CPU-only counterparts.
// The linux/windows `xgboost` wheels bundle CUDA kernels (~227 MB) and on Linux
// pull nvidia-nccl-cu12 (~399 MB unpacked); `xgboost-cpu` ships the same
// `xgboost` module in ~5 MB. No macOS `xgboost-cpu` wheel exists — the regular
// mac wheel is already CPU-only, so darwin keeps the original name.
const LITE_PACKAGE_RENAMES = Object.freeze({ ...(LITE_PROFILE_RAW.package_renames ?? {}) });

function applyLitePackageRenames(installSpecs, platform = process.platform) {
  if (platform === "darwin") {
    return Object.freeze([...installSpecs]);
  }
  return Object.freeze(
    installSpecs.map((spec) => {
      const base = spec.split(/[<>=!~ []/)[0].trim();
      const renamed = LITE_PACKAGE_RENAMES[base];
      return renamed ? renamed + spec.slice(base.length) : spec;
    }),
  );
}

const VISIBLE_PROFILE_MANAGED_OPTIONAL_NAMES = Object.freeze(
  Object.entries(recommendedConfig.optional ?? {})
    .filter(([, spec]) => Boolean(spec?.show_when_profile_managed))
    .map(([packageName]) => packageName),
);

const DEFAULT_OPTIONAL_PACKAGE_NAMES = Object.freeze(
  Object.entries(recommendedConfig.optional ?? {})
    .filter(([, spec]) => Boolean(spec?.default_install))
    .map(([packageName]) => packageName),
);

function getDefaultOptionalPackageNamesForProfile(rawProfile = {}) {
  const rawPackageNames = new Set(Object.keys(rawProfile.packages ?? {}));
  return Object.freeze(
    DEFAULT_OPTIONAL_PACKAGE_NAMES.filter((packageName) => {
      if (!rawPackageNames.has(packageName)) {
        return true;
      }
      return VISIBLE_PROFILE_MANAGED_OPTIONAL_NAMES.includes(packageName);
    }),
  );
}

const PROFILE_OPTIONAL_PACKAGES = Object.freeze(
  Object.fromEntries(
    Object.entries(recommendedConfig.profiles ?? {}).map(([profileId, rawProfile]) => {
      let optionalNames = getDefaultOptionalPackageNamesForProfile(rawProfile);
      if (profileId === LITE_PROFILE) {
        optionalNames = Object.freeze(
          optionalNames.filter((packageName) => !LITE_EXCLUDED_PACKAGE_NAMES.includes(packageName)),
        );
      }
      return [profileId, optionalNames];
    }),
  ),
);

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
  const visibleProfileManagedOptionalNames = new Set(VISIBLE_PROFILE_MANAGED_OPTIONAL_NAMES);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(rawProfiles).map(([profileId, rawProfile]) => {
        const rawPackageSpecs = Object.freeze(
          Object.fromEntries(
            Object.entries(rawProfile.packages ?? {}).map(([packageName, spec]) => [packageName, clonePackageSpec(spec)]),
          ),
        );
        const requiredPackageSpecs = Object.freeze(
          Object.fromEntries(
            Object.entries(rawPackageSpecs).filter(([packageName]) => !visibleProfileManagedOptionalNames.has(packageName)),
          ),
        );
        const managedOptionalPackageSpecs = Object.freeze(
          Object.fromEntries(
            Object.entries(rawPackageSpecs).filter(([packageName]) => visibleProfileManagedOptionalNames.has(packageName)),
          ),
        );
        const extraPackageNames = Object.freeze([...(PROFILE_OPTIONAL_PACKAGES[profileId] ?? [])]);
        const extraPackageSpecs = Object.freeze(
          Object.fromEntries(
            extraPackageNames.map((packageName) => {
              const packageSpec = managedOptionalPackageSpecs[packageName] ?? getOptionalPackageSpec(packageName);
              return [packageName, packageSpec];
            }),
          ),
        );
        const packageSpecs = Object.freeze({
          ...requiredPackageSpecs,
          ...extraPackageSpecs,
        });

        return [profileId, Object.freeze({
          id: profileId,
          label: rawProfile.label ?? profileId,
          description: rawProfile.description ?? "",
          platforms: Object.freeze([...(rawProfile.platforms ?? [])]),
          rawPackageSpecs,
          requiredPackageSpecs,
          managedOptionalPackageSpecs,
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
  return options.includeExtraPackages === false ? profile.requiredPackageSpecs : profile.packageSpecs;
}

function getProfileManagedPackageSpecs(profileId) {
  const profile = getProductProfile(profileId);
  return profile.managedOptionalPackageSpecs;
}

function getProfileManagedPackageInstallSpecs(profileId, options = {}) {
  const packageSpecs = getProfileManagedPackageSpecs(profileId);
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

function getProfilePackageInstallSpecs(profileId, options = {}) {
  const packageSpecs = getProfilePackageSpecs(profileId, options);
  const allowedPackages = options.packageNames ? new Set(options.packageNames) : null;
  const omittedPackages = new Set(options.omitPackages ?? []);

  const installSpecs = Object.entries(packageSpecs)
    .filter(([packageName]) => (!allowedPackages || allowedPackages.has(packageName)) && !omittedPackages.has(packageName))
    .map(([packageName, spec]) => stringifyPackageSpec(packageName, spec, {
      preferRecommended: options.preferRecommended,
    }));

  if (profileId === LITE_PROFILE) {
    return applyLitePackageRenames(installSpecs, options.platform);
  }
  return Object.freeze(installSpecs);
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

const MANAGED_RUNTIME_PACKAGES = PLUGIN_HOST_PACKAGES;

module.exports = {
  assertProfileSupportedOnPlatform,
  LEGACY_FLAVOR_TO_PROFILE,
  LITE_EXCLUDED_PACKAGE_NAMES,
  LITE_PROFILE,
  MANAGED_RUNTIME_PACKAGES,
  PBS_BASE_URL,
  PBS_TAG,
  PRODUCT_PROFILES,
  PROFILE_OPTIONAL_PACKAGES,
  PYTHON_BUILD_STANDALONE_ARCHIVES,
  PYTHON_VERSION,
  PYTHON_VERSION_MM,
  PLUGIN_DISTRIBUTION_VERSION,
  PLUGIN_HOST_PACKAGES,
  STANDALONE_V1_PROFILE,
  getArchiveFilename,
  getDownloadUrl,
  getProductProfile,
  getProfilePackageInstallSpecs,
  getProfileManagedPackageInstallSpecs,
  getProfilePackageSpecs,
  getProfileManagedPackageSpecs,
  isProfileSupportedOnPlatform,
  listSupportedPlatformArchKeys,
  resolveProfileForFlavor,
};
