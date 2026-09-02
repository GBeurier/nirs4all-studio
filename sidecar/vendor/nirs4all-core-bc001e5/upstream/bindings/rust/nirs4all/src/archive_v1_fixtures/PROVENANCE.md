# DAG-ML archive V1 frozen fixture mirror

These files are byte-for-byte test-data mirrors of the frozen DAG-ML archive
V1 contract. They are checked into `nirs4all-core` so the published crate's
test gate never depends on a sibling checkout.

Source and SHA-256 provenance (the source bytes and this mirror must match):

| Mirrored file | DAG-ML source file | SHA-256 |
| --- | --- | --- |
| `archive_workspace_manifest.v1.schema.json` | `dag-ml/docs/contracts/archive-v1/archive_workspace_manifest.v1.schema.json` (contract root) | `91daa7209843ab9043aa62a50200ff43b0f85f4c4e61ad8f73aa67b65a0a98dc` |
| `positive/portable_split_conformal.json` | `dag-ml/docs/contracts/archive-v1/fixtures/positive/portable_split_conformal.json` | `79acef8a6bedee201c9e7be7a398bf7ec0ef6de2c75777824ec9ec0633b4c451` |
| `positive/workspace_n4d_host_sidecar.json` | `dag-ml/docs/contracts/archive-v1/fixtures/positive/workspace_n4d_host_sidecar.json` | `6c3d678e955258a2f652c886d86358d4775dc98e9e85714166d88ad0e16b13ca` |
| `negative/refusals.v1.json` | `dag-ml/docs/contracts/archive-v1/fixtures/negative/refusals.v1.json` | `d6522da50d8debc87b5c824392d793fd8895e4822ebe80289199a246f502ded5` |

Mirror-source caution: this corpus was copied from the DAG-ML checkout on
branch `agent/dagml-completed-handoff`, whose recorded `HEAD` was
`3097da5658d0abca575d36db1f6a82f1f5d55490`; the archive V1 contract sources
were uncommitted in that checkout. The branch and `HEAD` are therefore context,
not a content identifier. Refreshes must verify the source-file SHA-256 values
above rather than infer identity from that revision.

The mirrored corpus contains only contract schema and synthetic JSON fixtures;
it carries no external datasets, model artifacts, or user data.

The fixtures intentionally use illustrative payload hashes and sizes. The Rust
unit tests materialize small stored ZIPs, rebinding non-refusal metadata to
their actual bytes while preserving the exact frozen mutation under test.
