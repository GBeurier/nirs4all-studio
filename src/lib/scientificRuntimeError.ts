import i18next from "i18next";

/** Sidecar admission codes the user can act on from Settings → Python. */
const MESSAGE_KEYS: Record<string, string> = {
  scientific_distribution_missing: "common.pythonEnv.error.missing",
  scientific_distribution_version_unsupported: "common.pythonEnv.error.versionUnsupported",
  scientific_distribution_inconsistent: "common.pythonEnv.error.inconsistent",
  scientific_library_import_failed: "common.pythonEnv.error.importFailed",
  studio_adapters_unavailable: "common.pythonEnv.error.adaptersUnavailable",
};

/** Turn native admission codes into actionable messages for the selected environment. */
export function scientificRuntimeErrorMessage(error: string | null | undefined): string | null {
  if (!error) return error ?? null;
  const key = MESSAGE_KEYS[error];
  return key ? i18next.t(key) : error;
}
