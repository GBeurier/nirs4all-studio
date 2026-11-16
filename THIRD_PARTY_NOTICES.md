# Third-Party Notices — nirs4all-studio

`nirs4all-studio` is distributed under `CeCILL-2.1 OR AGPL-3.0-or-later` (plus an optional
commercial license). Product packages bundle selected native, Python, Electron, and frontend
components. Their license notices are part of the distribution; the authoritative text also
ships with each upstream project.

The native product runtime embeds `nirs4all-methods` 1.2.1 from commit
`b8b942aea291102d974bb68eb09013f3453b0a86` (tree
`737178058bed3135d5b33de77388a1b709c7696c`) as `libn4m`, under CeCILL-2.1.
Studio compiles its Rust sidecar against immutable snapshots of `nirs4all-core`,
`dag-ml`/`dag-ml-core`, and `nirs4all-io`; their exact commits, inventories, package
digests, and license files are recorded beside those snapshots under `sidecar/vendor/`.
Installers contain no Python runtime. They redistribute, unmodified:

- `uv` (Astral), dual-licensed `MIT OR Apache-2.0`, as `resources/backend/tools/uv`
  (`uv.exe` on Windows), https://github.com/astral-sh/uv;
- the wheels of the required nirs4all packages (`nirs4all`, `nirs4all-core`, `dag-ml`,
  `dag-ml-data`, `nirs4all-io`, `nirs4all-methods`, `nirs4all-formats`) under
  `resources/backend/wheels/`, each under its own license.

The offline installer variant (`-offline`) additionally redistributes, under
`resources/backend/offline/`, the python-build-standalone CPython runtime archive
(https://github.com/astral-sh/python-build-standalone) and third-party wheels of the default
package set, each under its own license.
None of these Python components owns an HTTP listener, scheduler, store, or fallback path.

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

The Python scientific host runs `nirs4all` in the user's Python environment; the third-party
packages installed there are those of `nirs4all` (NumPy / pandas / SciPy / scikit-learn / …,
BSD-3-Clause / MIT / Apache-2.0) and the recommended packages the user chooses, each under its
own license.

License-family texts are bundled under [`LICENSES/`](LICENSES/), including CeCILL-2.1,
AGPL-3.0-or-later, MIT, Apache-2.0, and BSD-3-Clause.
