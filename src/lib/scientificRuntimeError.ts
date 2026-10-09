import i18next from "i18next";

/** Turn native admission codes into actionable messages for the selected environment. */
export function scientificRuntimeErrorMessage(error: string | null | undefined): string | null {
  if (error === "scientific_distribution_version_unsupported") {
    return i18next.t("common.pythonEnv.error.versionUnsupported");
  }
  if (error === "scientific_distribution_tampered") {
    return i18next.t("common.pythonEnv.error.tampered");
  }
  return error ?? null;
}
