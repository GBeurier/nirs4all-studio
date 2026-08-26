# Studio V1 frozen legacy boundary

This directory is the versioned authority for the observable legacy FastAPI
sidecar boundary that a future Rust sidecar must match before it can replace
anything. It is a compatibility baseline, not a new runtime and not an
authorization to move scientific computation out of `nirs4all`.

The boundary is `studio-v1`:

- `fixtures/routes.snapshot.json` freezes every physical Starlette matcher in
  its actual matching order, including `/openapi.json`, `/docs`, the docs
  redirect, `/redoc`, mounted children and WebSocket entries. Effective match
  ordinals preserve actual route matching order without relying on FastAPI's
  version-specific included-router wrapper representation.
- `fixtures/http-openapi.snapshot.json` freezes every documented HTTP operation
  and its generated request/response schemas. It retains two named, exact
  FastAPI representations: pre-0.139 and 0.139-plus. The compatibility ledger
  limits their divergence to ValidationError `input`/`ctx`, binary upload
  encoding, and the exact native `ConfusionMatrixRequest` collision mapping
  listed in `exceptions.json`; no observable property is dropped.
- `fixtures/websocket.snapshot.json` freezes the three WebSocket endpoints,
  input/output envelopes, channels and closed data shapes for every declared
  legacy message type. It ASGI-connects both job and training endpoints,
  records their auto-subscriptions and ping/pong frames, and separately records
  serializer-emitted forms. Enum values with no reachable producer are marked
  unreachable.
- `fixtures/behavior.snapshot.json` freezes pre- and post-lifespan readiness,
  actual 422 and unmanaged 500 responses (body, headers and content type),
  all job terminal/cooperative cancellation transitions, cancellation endpoint
  discovery, workspace-path response shape, and a live `/api/system/paths`
  capture whose three installation paths are typed `path` placeholders.
- `exceptions.json` is the only ledger for intentional non-snapshot values.

No snapshot may contain an absolute machine path, dataset, workspace content,
token, package inventory, timestamp, job identifier or user setting. Those
values are intentionally represented only by shape and semantics.

Response snapshots retain stable semantic headers such as `content-type` and
deliberately omit transport-dynamic `content-length`. The privacy scanner
accepts dynamic values only in the typed `{"$dynamic": "..."}` grammar; it
rejects POSIX paths (including `/run` and `/nix`), file URIs, Windows and UNC
paths, secret-bearing fields, and recognizable credential values.

## Validation and change control

Run `node scripts/run-python.cjs scripts/verify-studio-v1-contract.py --check`
or `npm run test:contract`. The command imports the app in a temporary,
quarantined runtime and performs local ASGI/lifespan probes only. Update and ML
background work are quiesced, so it neither reads user workspace payloads nor
contacts update/config services. Dynamic values are replaced by typed
placeholders before comparison.

The verifier validates every fixture and the exception ledger with the real
`jsonschema` Draft 2020-12 validator, plus cross-field WebSocket validation.
The supported framework policy is FastAPI >=0.115 and Starlette >=0.37; its
public-route capture is tested with the project runtime and, when present,
system Python 3.11. `--write` captures every fixture, validates temporary JSON,
fails closed on credential-shaped keys/values and Unix/Windows paths, and only
then atomically replaces the checked-in files.

Only after an approved compatibility review may a maintainer run the same
script with `--write`, inspect the diff, update the relevant schema and/or
exception ledger, and commit the complete reviewed change. A changed snapshot
without an accompanying review is a contract failure.

## Legacy behavior frozen here

Electron currently launches Python/Uvicorn, waits on `/api/health`, then polls
`/api/system/readiness`. Jobs are Python in-memory thread-pool jobs; cancelling
a running job sets a cooperative cancellation request and is not a force-kill.
HTTP errors use `{"detail": ...}`. The future sidecar must provide an explicit
versioned parity mapping before it becomes selectable; this freeze does not add
one and does not alter any legacy route.
