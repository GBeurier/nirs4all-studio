**Findings**

1. High: Webapp auto-update is effectively bricked by fail-closed checksum handling. `checksum_sha256` is never populated from GitHub release data or cache in [api/updates.py](/home/delete/nirs4all/nirs4all-studio/api/updates.py:509), but the download job passes it through at [api/updates.py](/home/delete/nirs4all/nirs4all-studio/api/updates.py:899). The downloader now rejects missing checksums at [api/update_downloader.py](/home/delete/nirs4all/nirs4all-studio/api/update_downloader.py:175), so current releases without checksum metadata will always fail before staging.

2. High: There are still direct mutating frontend fetches that bypass the token-aware API client. [ExportDialog.tsx](/home/delete/nirs4all/nirs4all-studio/src/components/spectra-synthesis/ExportDialog.tsx:83) posts to `/api/synthesis/generate` without `X-Nirs4all-Token`; [SynthesisPreviewContext.tsx](/home/delete/nirs4all/nirs4all-studio/src/components/spectra-synthesis/contexts/SynthesisPreviewContext.tsx:108) does the same for `/api/synthesis/preview`. In Electron token mode these will 401.

3. Medium: `is_public_path()` overmatches public API prefixes. [api/security.py](/home/delete/nirs4all/nirs4all-studio/api/security.py:67) includes `path.startswith(prefix)`, so `/api/healthXXX` is public, not just `/api/health` and `/api/health/...`. I did not see a current mutating route under that accidental prefix, but the gate logic is wrong and would silently exempt one.

4. Medium: Path-containment hardening missed a dangerous trained-model sink. `_resolve_bundle_path()` still accepts any absolute existing path at [api/models.py](/home/delete/nirs4all/nirs4all-studio/api/models.py:649), and `DELETE /models/trained/{model_id:path}` unlinks the resolved path at [api/models.py](/home/delete/nirs4all/nirs4all-studio/api/models.py:499). This is not introduced by the staged lines, but it is a Phase 0 coverage gap for model path containment.

5. Low: Token comparison is plain `!=` at [main.py](/home/delete/nirs4all/nirs4all-studio/main.py:109) and [api/security.py](/home/delete/nirs4all/nirs4all-studio/api/security.py:84). For a local bearer token, `secrets.compare_digest()` is the safer default.

6. Low: The CORS regex does not match `localhost.evil.com`, but `file://.*` at [main.py](/home/delete/nirs4all/nirs4all-studio/main.py:126) allows any file-origin page to read unauthenticated GET endpoints. Also verify packaged Electron’s actual `Origin`; if Chromium sends `null` for `file://`, this regex will not allow it.

**Positives**

The main `src/api/client.ts` request path and the direct upload fetch now attach `X-Nirs4all-Token`. WebSockets are unaffected. The path helper uses `realpath` plus a separator-aware prefix check, so it avoids the `workspace` vs `workspace_evil` bug. The ZIP guard catches absolute POSIX paths, Windows drive paths, and realpath escapes. The pip install allowlist blocks URLs/VCS specs/options/whitespace and uses argv, not shell.

**Checks**

Ran `git diff HEAD` and targeted file reads. `git diff --check HEAD` fails because `src/api/client.ts` and `vite.config.ts` appear staged with CRLF/trailing-whitespace churn. Full tests were not run in this read-only sandbox.