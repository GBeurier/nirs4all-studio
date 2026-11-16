# Publishing a Release — Quick Guide

Step-by-step checklist for publishing a new nirs4all-webapp release.

---

## Prerequisites

- Push access to `GBeurier/nirs4all-studio`
- The `release-unified.yml` GitHub Actions workflow is in place
- The installer electron-builder configuration (`electron-builder.installer.yml`) has its publish metadata configured

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

1. Build the installers for Linux x64 and Windows x64, each with its offline variant, and for macOS arm64 with its required-wheels asset
2. Build the native Docker image
3. Generate **SHA256 checksums** as `.sha256` sidecar files
4. Create a **GitHub Release** with all assets attached

Monitor progress at: `https://github.com/GBeurier/nirs4all-studio/actions`

Typical build time: ~15-25 minutes.

### 4. Verify the release

After CI completes:

1. Go to `https://github.com/GBeurier/nirs4all-studio/releases/latest`
2. Confirm all expected assets are present, each with its `.sha256`:
   - Windows x64 installer and offline installer (`-win-x64.exe`, `-win-x64-offline.exe`)
   - Linux x64 installer and offline installer (`-linux-amd64.deb`, `-linux-amd64-offline.deb`)
   - macOS arm64 installer (`-mac-arm64.dmg`)
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
3. Verify the "What's New" changelog shows correctly
4. Use the installer download action — the browser downloads the installer of the new version
5. Close the app, run the installer, and check that the app starts on the same Python environment

---

## Manual dispatch

If you need to rebuild without pushing a new tag:

1. Go to **Actions > Electron Build & Release**
2. Click **Run workflow**
3. Enter the tag (e.g., `1.1.0`) and choose whether to skip the Docker image

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
| Payload staging or the runtime contract gate fails | Check the wheel locks against `recommended-config.json` (`node scripts/python-wheel-lock.cjs`) and the native runtime contract; see [PACKAGING.md](PACKAGING.md#troubleshooting) |
| No assets on the release | Check the CI logs for electron-builder errors; ensure `GH_TOKEN` secret is set |
| Update check returns "Up to date" | Verify the tag version is higher than the installed version; check `version.json` |
| Checksum verification fails | Re-run the CI — the `.sha256` file may have been generated from a different build |
