# Jobs and WebSockets

Long-running work should not block HTTP request handlers. Use background jobs
and WebSocket progress channels for training, evaluation, AutoML, and similar
operations.

## Job lifecycle

Typical flow:

1. HTTP route validates the request.
2. Route creates a run or job record.
3. Route schedules work through `JobManager`.
4. Route returns quickly with run/job metadata.
5. Worker calls nirs4all or adapter services.
6. Worker emits progress through callbacks.
7. WebSocket subscribers receive progress.
8. Worker persists final outputs and state.
9. UI invalidates or refetches server state.

## Job manager

`api/jobs/manager.py` provides the shared execution path for long-running jobs.
Use it when work may take seconds or minutes.

Do:

- keep request handlers responsive
- include stable job IDs
- report progress in coarse but meaningful phases
- handle cancellation requests where the underlying work supports it
- persist enough state to inspect failures later

Avoid:

- sleeping or looping inside HTTP request handlers
- emitting incompatible progress payloads
- mixing UI-only state into nirs4all workspace records
- swallowing exceptions without updating run state

## WebSocket endpoints

| Endpoint | Use |
| --- | --- |
| `/ws` | General pub/sub endpoint with explicit subscribe messages. |
| `/ws/job/{job_id}` | Automatically subscribes to `job:{job_id}`. |
| `/ws/training/{job_id}` | Training-specific connection that subscribes to the job channel. |
| `/api/ws/stats` | Connection count for diagnostics. |

General subscription message:

```json
{
  "type": "subscribe",
  "channel": "job:<job_id>",
  "data": {}
}
```

## Channels

Use stable channel names:

| Channel | Purpose |
| --- | --- |
| `job:<job_id>` | Generic updates for one job. |
| `training:<job_id>` | Training-oriented updates when needed. |
| `system` | System-wide notifications. |

## Progress payload guidance

Progress events should be easy for the UI to render without knowing backend
internals. Include:

- event type
- job or run ID
- phase name
- numeric progress when meaningful
- message suitable for a user
- structured metrics when available
- terminal state for completion, failure, or cancellation

Do not send raw exceptions, secrets, full paths that are not already user
selected, request bodies, tokens, or large arrays over WebSocket.

## Frontend consumption

The frontend should subscribe when a run detail or active run view is mounted,
then cleanly unsubscribe or close the connection. Use server state refetching
for durable records; WebSocket messages are progress hints, not the source of
truth.

## Failure behavior

When a job fails:

- mark the job/run failed
- capture a clear user-facing error
- log the backend exception
- emit a terminal progress event if possible
- preserve enough context for run detail and logs

Expected user errors should be shown in the UI, not sent as diagnostics noise.
