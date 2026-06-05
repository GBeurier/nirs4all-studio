**Findings**

- **Medium:** [src/context/ActiveRunContext.tsx](/home/delete/nirs4all/nirs4all-studio/src/context/ActiveRunContext.tsx:105) switches to 3s when WS is down, but the poll reconciliation only updates status, not progress/message ([line 240](/home/delete/nirs4all/nirs4all-studio/src/context/ActiveRunContext.tsx:240)). If the widget loses WS messages, progress can stay at the last WS value until the run completes/disappears.

- **Medium:** [src/pages/RunProgress.tsx](/home/delete/nirs4all/nirs4all-studio/src/pages/RunProgress.tsx:707) gates polling on a single `wsConnected` boolean. `useRunWebSocket` can reconnect an old run after route cleanup ([line 192](/home/delete/nirs4all/nirs4all-studio/src/pages/RunProgress.tsx:192)), and that stale socket can call `handleConnected` ([line 845](/home/delete/nirs4all/nirs4all-studio/src/pages/RunProgress.tsx:845)), making the current run poll at 20s even if its own WS is not connected.

- **Medium:** [src/hooks/useSpectralData.ts](/home/delete/nirs4all/nirs4all-studio/src/hooks/useSpectralData.ts:23) keys cache only by `datasetId` and `datasetName`, with 30m freshness ([line 51](/home/delete/nirs4all/nirs4all-studio/src/hooks/useSpectralData.ts:51)). If a dataset is refreshed/reconfigured under the same id/name, Playground can reuse the old matrix; I don’t see invalidation for `workspaceDataset` after dataset edit/refresh flows.

- **Low:** [src/hooks/useSpectralData.ts](/home/delete/nirs4all/nirs4all-studio/src/hooks/useSpectralData.ts:130) commits workspace selection before fetch success and never clears it on query error. The loaded-data header is gated by `rawData`, so I don’t see that exact bad header state, but `dataSource/currentDatasetInfo` remain set and get persisted by Playground session state.

**Checks**

WS real-time path is still present: `RunProgress` invalidates `["run", runId]` on WS messages, and `ActiveRunContext` still updates the progress map directly. Idle discovery still runs at ~20s when there are no active runs. `enabled` for workspace dataset fetch is correctly workspace-only.