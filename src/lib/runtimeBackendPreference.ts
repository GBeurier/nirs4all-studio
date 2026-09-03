/**
 * Studio's runtime engine is a product invariant, not a user preference.
 *
 * Keep the retired storage key only long enough to remove values written by
 * older Studio builds. No persisted value is parsed or projected into a launch.
 */
export const STRICT_NATIVE_RUNTIME_ENGINE = "dag-ml" as const;

export const RETIRED_RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY =
  "nirs4all.runtimeBackendPreference";

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Remove the retired selector preference without ever interpreting it. */
export function migrateRetiredRuntimeBackendPreference(): void {
  try {
    getLocalStorage()?.removeItem(RETIRED_RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts. The value is
    // still ignored because no launch path reads this retired preference.
  }
}
