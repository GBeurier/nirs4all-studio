/** Refetch cadence for the run progress page. Pure so the polling rules stay testable. */

const ACTIVE_RUN_POLL_MS = 1000;
/** Safety-net poll while the run WebSocket is connected; live updates arrive over the socket. */
const CONNECTED_RUN_POLL_MS = 10_000;
const ERROR_RUN_POLL_MS = 5000;
/** A just-created job may not have an execution record yet; give up waiting after this many empty reads. */
const MAX_MISSING_RECORD_POLLS = 10;

/** Minimum spacing between query invalidations triggered by WebSocket progress messages. */
export const WS_INVALIDATE_THROTTLE_MS = 1000;

function activeRunInterval(wsConnected: boolean): number {
  return wsConnected ? CONNECTED_RUN_POLL_MS : ACTIVE_RUN_POLL_MS;
}

export function getRunDetailRefetchInterval(status: string | undefined, wsConnected: boolean): number | false {
  return status === "running" || status === "queued" ? activeRunInterval(wsConnected) : false;
}

interface ExecutionJobRecordPollState {
  /** `undefined` while loading or failed, `null` when the job has no execution record (404). */
  record: { status: string } | null | undefined;
  queryStatus: "pending" | "error" | "success";
  /** Number of successful reads so far. */
  dataUpdateCount: number;
  wsConnected: boolean;
}

export function getExecutionJobRecordRefetchInterval({
  record,
  queryStatus,
  dataUpdateCount,
  wsConnected,
}: ExecutionJobRecordPollState): number | false {
  if (record === undefined) return queryStatus === "error" ? ERROR_RUN_POLL_MS : false;
  // A missing record is polled briefly (it may be about to appear), never forever.
  if (record === null) return dataUpdateCount <= MAX_MISSING_RECORD_POLLS ? ACTIVE_RUN_POLL_MS : false;
  return record.status === "running" || record.status === "pending" ? activeRunInterval(wsConnected) : false;
}
