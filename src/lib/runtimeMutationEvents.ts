/** Notify readiness consumers while package files may be changing on disk. */
export const RUNTIME_MUTATION_EVENT = "nirs4all-runtime-mutation";
let pendingMutations = 0;

export function isRuntimeMutationRequest(endpoint: string, body?: unknown): boolean {
  if (body && typeof body === "object" && "dry_run" in body && body.dry_run === true) return false;
  const path = endpoint.split("?")[0];
  return path === "/config/align"
    || path === "/updates/nirs4all/install"
    || /^\/updates\/dependencies\/(install|uninstall|update|revert)$/.test(path)
    || /^\/updates\/(runtime|venv)\/snapshots\/[^/]+\/restore$/.test(path);
}

function dispatchRuntimeMutationState(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RUNTIME_MUTATION_EVENT, { detail: { pending: pendingMutations > 0 } }));
  }
}

export async function duringRuntimeMutation<T>(operation: () => Promise<T>): Promise<T> {
  pendingMutations += 1;
  dispatchRuntimeMutationState();
  try {
    return await operation();
  } finally {
    pendingMutations -= 1;
    dispatchRuntimeMutationState();
  }
}
