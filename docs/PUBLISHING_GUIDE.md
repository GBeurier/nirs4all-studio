# Publishing a Release - Quick Guide

Step-by-step checklist for publishing a new nirs4all Studio release from `GBeurier/nirs4all-studio`.

---

## Prerequisites

- Push access to `GBeurier/nirs4all-studio`
- The `.github/workflows/release-unified.yml` GitHub Actions workflow is in place
- The packaging source of truth is documented in `docs/PACKAGING.md`

## Steps

### 1. Bump the version

Edit `version.json` at the repo root:

```json
{
  "version": "1.1.0",
  "build_date": "2026-02-10T00:00:00Z",
  "commit": "abc1234"
}
```

Also update `package.json` to match (the CI does this automatically, but keeping them in sync avoids confusion):

```bash
npm version 1.1.0 --no-git-tag-version
```

### 2. Commit and tag

```bash
git add version.json package.json package-lock.json
git commit -m "Release 1.1.0"
git tag 1.1.0
git push origin main --tags
```

For a pre-release (beta):

```bash
git tag 1.1.0-beta.1
git push origin 1.1.0-beta.1
```

### 3. Wait for CI

The `release-unified.yml` workflow triggers on `[0-9]*` tags (no `v` prefix). It will:

1. Build installer assets for Windows, macOS, and Linux
2. Build Windows portable assets
3. Build all-in-one archives unless `skip_all_in_one` is enabled
4. Build Docker images unless `skip_docker` is enabled
5. Generate **SHA256 checksums** as `.sha256` sidecar files
6. Create a **GitHub Release** with all assets attached

Monitor progress at: `https://github.com/GBeurier/nirs4all-studio/actions`

Typical build time: ~15-25 minutes.

### 4. Verify the release

After CI completes:

1. Go to `https://github.com/GBeurier/nirs4all-studio/releases/latest`
2. Confirm all expected assets are present:
   - `nirs4all Studio-<version>-win-x64.exe` + `.sha256`
   - `nirs4all Studio-<version>-win-x64-portable.exe` + `.sha256`
   - `nirs4all Studio-<version>-mac-x64.dmg` and `nirs4all Studio-<version>-mac-arm64.dmg` + `.sha256`
   - `nirs4all Studio-<version>-linux-x64.AppImage` + `.sha256`
   - `nirs4all Studio-<version>-linux-x64.deb` + `.sha256`
   - all-in-one archives when enabled: `.zip` on Windows/macOS and `.tar.gz` on Linux
3. Verify checksums: download an asset and its `.sha256` file, then:
   ```bash
   sha256sum -c "nirs4all Studio-1.1.0-win-x64.exe.sha256"
   ```

### 5. Edit release notes (optional)

The CI generates template release notes. You can edit them on GitHub to add:

- Highlights of new features
- Breaking changes
- Migration instructions
- Known issues

The webapp's update dialog will display these notes to users via the changelog viewer.

### 6. Verify the update flow

On a machine running the **previous** version:

1. Open the app, go to **Settings > Advanced > Updates**
2. Click **Check Now** — the new version should appear
3. Click **Update** — download should start with progress
4. Verify the "What's New" changelog shows correctly
5. Click **Apply Update** to test the full restart cycle

---

## Manual dispatch

If you need to rebuild without pushing a new tag:

1. Go to **Actions > Release**
2. Click **Run workflow**
3. Enter the tag/version, for example `1.1.0`
4. Use `skip_all_in_one` and `skip_docker` to limit the build matrix

For an installer-only Windows RC smoke build while production remains held:

1. Run **Actions > Release** on `main`
2. Set `tag` to the current RC version, for example `1.0.0-rc.3`
3. Set `skip_all_in_one=true`
4. Keep `skip_docker=true`

When the RC tag does not exist as a tag, the workflow stamps that version into the artifacts but checks out the triggering commit. This produces unsigned test artifacts without creating a release tag or publishing a production release. The current prepared RC artifact set is workflow run `29141166400` for `1.0.0-rc.3`.

## Local Windows RC installer

For a local installer candidate while the Studio production release remains held, run from a native Windows checkout such as `C:\src\nirs4all\nirs4all-studio`, not from WSL or a `\\wsl...` UNC path:

```powershell
npm install
npm run release:windows-rc -- --version 1.0.0-rc.3
```

The helper rebuilds the sibling `..\nirs4all-ui` package, runs the quick release smoke unless `--skip-smoke` is passed, stamps the RC version locally, and then builds Windows installer artifacts with publishing disabled. Expected outputs:

```text
release/nirs4all Studio-1.0.0-rc.3-win-x64.exe
release/nirs4all Studio-1.0.0-rc.3-win-x64-portable.exe
```

Use `npm run release:windows-rc -- --version 1.0.0-rc.3 --skip-smoke` only after `npm run release:smoke` has already passed on the same checkout.

---

## Checklist

- [ ] `version.json` updated
- [ ] Tag pushed (`[0-9]*` format, no `v` prefix)
- [ ] CI workflow completed successfully
- [ ] All platform assets attached to the release
- [ ] `.sha256` checksum files present for each asset
- [ ] Release notes reviewed/edited
- [ ] Update flow tested from a previous version

---

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| CI fails in installer jobs | Check `electron-builder.installer.yml`, backend source copy logs, and `scripts/check-dep-sync.cjs` output |
| CI fails in all-in-one jobs | Check `docs/PACKAGING.md`, `scripts/build-archive-standalone.cjs`, runtime bake logs, and constraint files |
| No assets on the release | Check the CI logs for electron-builder or upload errors; ensure release permissions/secrets are available |
| Update check returns "Up to date" | Verify the tag version is higher than the installed version; check `version.json` |
| Checksum verification fails | Re-run the CI — the `.sha256` file may have been generated from a different build |
| Download resumes but fails checksum | Delete the partial download in `~/.nirs4all-webapp/update_cache/` and retry |
