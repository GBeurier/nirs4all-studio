# Publishing a Release — Quick Guide

Step-by-step checklist for publishing a new nirs4all-webapp release.

---

## Prerequisites

- Push access to `GBeurier/nirs4all-webapp`
- The `electron-release.yml` GitHub Actions workflow is in place
- `electron-builder.yml` has the `publish` section configured (already done)

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
git commit -m "Release v1.1.0"
git tag v1.1.0
git push origin main --tags
```

For a pre-release (beta):

```bash
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1
```

### 3. Wait for CI

The `electron-release.yml` workflow triggers on `v*` tags. It will:

1. Build **CPU** and **GPU** flavors for Linux and Windows
2. Generate **SHA256 checksums** as `.sha256` sidecar files
3. Create a **GitHub Release** with all assets attached

Monitor progress at: `https://github.com/GBeurier/nirs4all-webapp/actions`

Typical build time: ~15-25 minutes.

### 4. Verify the release

After CI completes:

1. Go to `https://github.com/GBeurier/nirs4all-webapp/releases/latest`
2. Confirm all expected assets are present:
   - `nirs4all-Studio-<version>-win-x64.exe` + `.sha256` (CPU)
   - `nirs4all-Studio-<version>-gpu-win-x64.exe` + `.sha256` (GPU)
   - `nirs4all-Studio-<version>-linux-x64.AppImage` + `.sha256` (CPU)
   - `nirs4all-Studio-<version>-linux-x64.deb` + `.sha256` (CPU)
   - GPU Linux variants
3. Verify checksums: download an asset and its `.sha256` file, then:
   ```bash
   sha256sum -c nirs4all-Studio-1.1.0-win-x64.exe.sha256
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

1. Go to **Actions > Electron Build & Release**
2. Click **Run workflow**
3. Enter the tag (e.g., `v1.1.0`) and select flavor (`cpu`, `gpu`, or `both`)

---

## Checklist

- [ ] `version.json` updated
- [ ] Tag pushed (`v*` format)
- [ ] CI workflow completed successfully
- [ ] All platform assets attached to the release
- [ ] `.sha256` checksum files present for each asset
- [ ] Release notes reviewed/edited
- [ ] Update flow tested from a previous version

---

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| CI fails on PyInstaller step | Check that `requirements-cpu.txt` / `requirements-gpu.txt` are up to date |
| No assets on the release | Check the CI logs for electron-builder errors; ensure `GH_TOKEN` secret is set |
| Update check returns "Up to date" | Verify the tag version is higher than the installed version; check `version.json` |
| Checksum verification fails | Re-run the CI — the `.sha256` file may have been generated from a different build |
| Download resumes but fails checksum | Delete the partial download in `~/.nirs4all-webapp/update_cache/` and retry |
