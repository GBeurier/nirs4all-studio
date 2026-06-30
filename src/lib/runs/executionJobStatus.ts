export function isActiveExecutionStatus(status: string): boolean {
  return status === "pending" || status === "queued" || status === "running";
}

export function isFailedExecutionStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

export function isRetryableExecutionStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}
