/**
 * Build/runtime feature flags.
 *
 * Toggles for features that are temporarily hidden from the UI without deleting
 * their code. Flip a flag back to `true` to re-enable.
 */

/**
 * Transfer Analysis (Lab tab). Hidden until the underlying transfer algorithms
 * are revisited. When `false`, the Lab does not render the Transfer tab and
 * `/lab/transfer` redirects back to the Lab. The page, API client, and types
 * stay intact.
 */
export const TRANSFER_ENABLED: boolean = false;
