# Third-Party Notices — nirs4all-core

`nirs4all-core` is distributed under `CeCILL-2.1 OR AGPL-3.0-or-later` (plus an optional
commercial license; see [`LICENSING.md`](LICENSING.md)). nirs4all-core does **not** vendor the
components below — they are pulled from their official distributions — but their licenses are
acknowledged here as a courtesy and for compliance. Licenses are reported on a best-effort
basis; the authoritative text always ships with each upstream project.

`nirs4all-core` is a portable aggregate distribution that re-exports sibling crates (`dag-ml`, `dag-ml-data`, `nirs4all-formats`, `nirs4all-io`, `nirs4all-datasets`, `nirs4all-methods`) without adding new parsers or methods. Each re-exported sibling carries its own license (see that project). Beyond the siblings, it depends on the Rust crate ecosystem, predominantly **MIT** and/or **Apache-2.0**. Principal direct dependencies include:

| Component | License (SPDX) | Upstream |
|---|---|---|
| `serde`, `serde_json` | MIT OR Apache-2.0 | https://github.com/serde-rs |
| `anyhow`, `thiserror` | MIT OR Apache-2.0 | https://github.com/dtolnay |
| `clap` | MIT OR Apache-2.0 | https://github.com/clap-rs/clap |
| `sha2` (RustCrypto) | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |

For the exhaustive, version-pinned dependency tree and its licenses, run:

```
cargo tree
cargo deny check licenses
```

> Note: the re-exported siblings currently use `CeCILL-2.1 OR AGPL-3.0-or-later`.

License-family texts are bundled under [`LICENSES/`](LICENSES/): MIT, Apache-2.0, BSD-3-Clause.
