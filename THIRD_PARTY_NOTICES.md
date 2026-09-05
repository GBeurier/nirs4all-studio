# Third-Party Notices — nirs4all-studio

`nirs4all-studio` is distributed under `CeCILL-2.1 OR AGPL-3.0-or-later` (plus an optional
commercial license). Product packages bundle selected native, Python, Electron, and frontend
components. Their license notices are part of the distribution; the authoritative text also
ships with each upstream project.

The native product runtime embeds `nirs4all-methods` 1.0.18 from commit
`a9faae2909c71a833bb7f3b208dc20548cf01588` (tree
`5c39dde72afab2ff725ff7b1b53e69a17b9bf865`) as `libn4m`, under CeCILL-2.1.
Studio compiles its Rust sidecar against immutable snapshots of `nirs4all-core`,
`dag-ml`/`dag-ml-core`, and `nirs4all-io`; their exact commits, inventories, package
digests, and license files are recorded beside those snapshots under `sidecar/vendor/`.
The bounded CPython plugin closure embeds the exact
`nirs4all` wheel identified by `STUDIO_RUNTIME_CONTRACT.json`. None of these Python components
owns an HTTP listener, scheduler, store, or fallback path.

Its frontend is built on the npm/Node ecosystem; the vast majority of dependencies are **MIT**-licensed, with some **Apache-2.0** and **BSD** components. Principal dependencies:

| Component | License (SPDX) | Upstream |
|---|---|---|
| React, React DOM | MIT | https://github.com/facebook/react |
| Vite | MIT | https://github.com/vitejs/vite |
| Radix UI (`@radix-ui/*`) | MIT | https://github.com/radix-ui/primitives |
| Tailwind CSS | MIT | https://github.com/tailwindlabs/tailwindcss |
| TanStack Query | MIT | https://github.com/TanStack/query |
| three.js, `@react-three/*` | MIT | https://github.com/mrdoob/three.js |
| Recharts | MIT | https://github.com/recharts/recharts |
| `zod`, `clsx`, `lucide-react`, `framer-motion` | MIT | (respective repos) |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Electron | MIT | https://github.com/electron/electron |
| `@sentry/*` | MIT | https://github.com/getsentry/sentry-javascript |

For the exhaustive, version-pinned dependency tree and its licenses, run:

```
npx license-checker --summary      # or: pnpm licenses list
```

The bundled Python scientific plugin host reuses `nirs4all`; its third-party licenses are those
of `nirs4all` (NumPy / pandas / SciPy / scikit-learn / …, BSD-3-Clause / MIT / Apache-2.0).

License-family texts are bundled under [`LICENSES/`](LICENSES/), including CeCILL-2.1,
AGPL-3.0-or-later, MIT, Apache-2.0, and BSD-3-Clause.
