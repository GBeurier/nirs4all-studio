/** Turn native admission codes into actionable messages for the selected environment. */
export function scientificRuntimeErrorMessage(error: string | null | undefined): string | null {
  if (error === "scientific_distribution_version_unsupported") {
    return "The selected Python environment has an unsupported nirs4all version. Choose Studio's included environment in Settings, or install nirs4all 1.4.7 in the selected environment.";
  }
  if (error === "scientific_distribution_tampered") {
    return "The installed nirs4all package failed its integrity check. Choose Studio's included environment in Settings, or reinstall nirs4all in the selected environment.";
  }
  return error ?? null;
}
