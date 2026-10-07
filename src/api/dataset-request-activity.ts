/** Let the background readiness heartbeat yield to foreground scientific reads. */
const pending = new Set<symbol>();

export function hasDatasetRequestInFlight(): boolean {
  return hasScientificRequestInFlight();
}

export function hasScientificRequestInFlight(): boolean {
  return pending.size > 0;
}

export async function withDatasetRequestActivity<T>(request: () => Promise<T>): Promise<T> {
  return withScientificRequestActivity(request);
}

export async function withScientificRequestActivity<T>(request: () => Promise<T>): Promise<T> {
  const token = Symbol();
  pending.add(token);
  try {
    return await request();
  } finally {
    pending.delete(token);
  }
}
