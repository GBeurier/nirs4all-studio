# Third-Party Notices — nirs4all-studio

`nirs4all-studio` is distributed under `CeCILL-2.1 OR AGPL-3.0-or-later` (plus an optional
commercial license; see [`LICENSING.md`](LICENSING.md)). nirs4all-studio does **not** vendor the
components below — they are pulled from their official distributions — but their licenses are
acknowledged here as a courtesy and for compliance. Licenses are reported on a best-effort
basis; the authoritative text always ships with each upstream project.

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

The bundled Python scientific backend reuses `nirs4all`; its third-party licenses are those of `nirs4all` (NumPy / pandas / SciPy / scikit-learn / …, BSD-3-Clause / MIT / Apache-2.0).

License-family texts are bundled under [`LICENSES/`](LICENSES/): MIT, Apache-2.0, BSD-3-Clause.
