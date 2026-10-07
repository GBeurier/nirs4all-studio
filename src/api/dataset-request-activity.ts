/** Let the background readiness heartbeat yield to bounded dataset inspection. */
const pending = new Set<symbol>();

export function hasDatasetRequestInFlight(): boolean {
  return pending.size > 0;
}

export async function withDatasetRequestActivity<T>(request: () => Promise<T>): Promise<T> {
  const token = Symbol();
  pending.add(token);
  try {
    return await request();
  } finally {
    pending.delete(token);
  }
}
