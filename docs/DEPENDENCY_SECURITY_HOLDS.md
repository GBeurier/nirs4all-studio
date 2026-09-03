# Dependency security holds for Studio 0.11

Studio 0.11 has no npm advisory rated critical or high. Electron is pinned to
41.10.3, the first unaffected 41.x release for `GHSA-9f4c-93c8-jc8g`; this
minimal major upgrade avoids expanding the Electron API migration surface.

Two moderate React Router advisories remain on `react-router-dom` 6.30.6. The
automated fix requires React Router 7.18.3 and a functional router migration
that is disproportionate for this release:

- `GHSA-wrjc-x8rr-h8h6` concerns open redirects through backslash-prefixed
  paths. Studio navigation uses client-side application routes; callers must
  continue to encode dynamic path segments and must not pass untrusted raw
  destinations to `navigate`, redirects, or links. This reduces but does not
  remove exposure.
- `GHSA-337j-9hxr-rhxg` concerns constructor injection while hydrating
  server-rendered error data. Studio is a `createRoot` client-side SPA and does
  not use React Router SSR hydration or `deserializeErrors`, so the affected
  execution path is not exercised.

These are release-scoped holds, not permanent exceptions. Re-evaluate both
advisories during the post-0.11 router migration and remove this file once the
application is on an unaffected React Router release.
