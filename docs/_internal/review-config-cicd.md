# Configuration and CI/CD Review - nirs4all_webapp

**Review Date**: 2026-01-27
**Version Reviewed**: 1.0.0
**Reviewer**: Claude Opus 4.5

---

## 1. Executive Summary

This document provides a comprehensive review of all configuration files, build scripts, and CI/CD setup for the nirs4all-webapp project. The overall configuration is well-structured and follows modern best practices for a React/Vite/Electron application with a FastAPI Python backend.

### Summary Statistics

| Category | Files Reviewed | Critical Issues | Major Issues | Minor Issues |
|----------|----------------|-----------------|--------------|--------------|
| Package & Dependencies | 6 | 0 | 2 | 5 |
| TypeScript Config | 3 | 0 | 1 | 2 |
| Build Config | 5 | 0 | 2 | 3 |
| CI/CD Workflows | 5 | 1 | 3 | 4 |
| Scripts | 8 | 0 | 2 | 3 |
| Environment | 4 | 0 | 1 | 2 |
| **Total** | **31** | **1** | **11** | **19** |

### Key Findings

**Strengths:**
- Well-organized project structure with clear separation of concerns
- Comprehensive CI/CD workflows covering all platforms
- Good cross-platform script support (Windows, Linux, macOS)
- Proper TypeScript configuration with strict mode
- Modern tooling (Vite 7, React 19, Electron 40, Tailwind CSS 3)

**Areas for Improvement:**
- Node.js version mismatch between `.nvmrc` (22) and package.json (>=20)
- Duplicate keyframe definitions in Tailwind config
- Missing vitest configuration file (tests may not work)
- Playwright workflow uses inconsistent Node.js version
- Some CI workflows reference non-existent spec files

---

## 2. Critical Issues (Blocks Release)

### 2.1 CI Workflow References Non-Existent Spec Files

**Location:** `.github/workflows/release.yml:131, 178, 255, 307`

**Description:** The release workflow references `nirs4all-webapp.spec` PyInstaller spec file, but the actual file in the repository is named `backend.spec`.

**Impact:** Release builds will fail with "file not found" errors when triggered by version tags.

**Suggested Fix:**
```yaml
# Change from:
- name: Build with PyInstaller
  run: pyinstaller nirs4all-webapp.spec --clean --noconfirm

# To:
- name: Build with PyInstaller
  run: pyinstaller backend.spec --clean --noconfirm
```

---

## 3. Major Issues (Should Fix)

### 3.1 Missing Vitest Configuration File

**Location:** Project root (missing `vitest.config.ts`)

**Description:** The project uses Vitest for testing (`npm run test` runs `vitest run`), but there is no `vitest.config.ts` or `vitest.config.js` file. Vitest will fall back to Vite's configuration, but test-specific settings (coverage paths, setup files, etc.) may be missing.

**Impact:** Tests may not have proper configuration for coverage, mocking, or test environment setup.

**Suggested Fix:** Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'storybook-static/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 3.2 Playwright Workflow Uses Inconsistent Node Version

**Location:** `.github/workflows/playwright.yml:14`

**Description:** The Playwright workflow uses `node-version: lts/*` while all other workflows use `NODE_VERSION: '22'`. This inconsistency could cause test failures due to Node.js version differences.

**Impact:** E2E tests may pass in CI but fail locally (or vice versa) due to Node.js version differences.

**Suggested Fix:**
```yaml
env:
  NODE_VERSION: '22'

jobs:
  test:
    steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ env.NODE_VERSION }}
```

### 3.3 Playwright Config Uses Unix-Only Backend Command

**Location:** `playwright.config.ts:85`

**Description:** The webServer command uses `.venv/bin/python main.py` which only works on Linux/macOS. On Windows, it would be `.venv\Scripts\python main.py`.

**Impact:** Playwright tests cannot be run locally on Windows without manual intervention.

**Suggested Fix:**
```typescript
webServer: [
  {
    command: process.platform === 'win32'
      ? '.venv\\Scripts\\python main.py'
      : '.venv/bin/python main.py',
    // ...
  },
]
```

### 3.4 Build-Backend Script Looks for Wrong venv Location

**Location:** `scripts/build-backend.cjs:66`

**Description:** The build-backend script looks for `.venv` in the project root, but the launcher scripts expect `.venv` in the parent directory (`../nirs4all/.venv`). This inconsistency could cause build failures.

**Impact:** Backend build scripts may fail to find the Python virtual environment.

**Suggested Fix:** Standardize on one location. If the intent is to use a shared venv:
```javascript
const venvPath = path.join(projectRoot, "..", ".venv");
```

### 3.5 Missing orjson in requirements-cpu.txt

**Location:** `requirements-cpu.txt` (compared to `requirements.txt`)

**Description:** `requirements.txt` includes `orjson>=3.10.0` but `requirements-cpu.txt` does not. orjson provides faster JSON serialization for FastAPI.

**Impact:** CPU builds may have slower JSON performance.

**Suggested Fix:** Add to `requirements-cpu.txt`:
```
orjson>=3.10.0
```

### 3.6 Tailwind Config Has Duplicate Keyframe Definitions

**Location:** `tailwind.config.ts:90-106, 141-156`

**Description:** The `accordion-down` and `accordion-up` keyframes are defined twice in the configuration, which is unnecessary and confusing.

**Impact:** Code maintainability issue; no functional impact.

**Suggested Fix:** Remove the duplicate definitions (lines 141-156).

### 3.7 README References Non-Existent Scripts

**Location:** `README.md:73-78, 108-114`

**Description:** The README references convenience scripts like `scripts/dev-full.cmd`, `scripts/dev-start.cmd`, `scripts/dev-backend.cmd`, etc., but these scripts do not exist. The actual scripts are `scripts/launcher.cmd` and `scripts/launcher.sh`.

**Impact:** Users following the README will encounter errors.

**Suggested Fix:** Update README to reference the correct scripts:
```markdown
# Start development servers
scripts\launcher.cmd start web:dev    # Windows
./scripts/launcher.sh start web:dev   # Linux/macOS

# Or use npm scripts
npm run start:web
```

### 3.8 CI Tests Continue on Error

**Location:** `.github/workflows/ci.yml:45, pre-release.yml:78`

**Description:** The test steps have `continue-on-error: true`, meaning failing tests won't fail the CI build.

**Impact:** Broken tests could be merged to main branch without detection.

**Suggested Fix:** Remove `continue-on-error: true` or change to `continue-on-error: false` once tests are stable.

---

## 4. Minor Issues (Nice to Fix)

### 4.1 Node.js Version Mismatch

**Location:** `.nvmrc` vs `package.json`

**Description:** `.nvmrc` specifies Node 22, while `package.json` specifies `"node": ">=20"`. While compatible, this is inconsistent.

**Suggested Fix:** Update `package.json` to match:
```json
"engines": {
  "node": ">=22",
  "npm": ">=10"
}
```

### 4.2 ESLint Rule Disabled Without Comment

**Location:** `eslint.config.js:27`

**Description:** `@typescript-eslint/no-unused-vars` is disabled without explanation.

**Suggested Fix:** Add comment explaining why, or enable with warnings:
```javascript
// Allow unused vars prefixed with underscore
"@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
```

### 4.3 TypeScript Target Version Mismatch

**Location:** `tsconfig.app.json` vs `tsconfig.node.json`

**Description:** `tsconfig.app.json` targets ES2020, while `tsconfig.node.json` targets ES2022. This is intentional (browser vs Node) but could be documented.

**Suggested Fix:** Add comment explaining the difference in `tsconfig.json`.

### 4.4 Missing package-lock.json in Repository

**Location:** `.gitignore:29`

**Description:** `package-lock.json` is gitignored, but npm workspaces recommend committing it for reproducible builds.

**Impact:** Builds may be inconsistent across environments.

**Suggested Fix:** Consider removing from `.gitignore` and committing `package-lock.json`.

### 4.5 Hardcoded Copyright Year

**Location:** `electron-builder.yml:4`

**Description:** Copyright year is hardcoded as "2024".

**Suggested Fix:** Update to "2024-2026" or use dynamic year in build script.

### 4.6 Duplicate workspace/ Entry in .gitignore

**Location:** `.gitignore:41, 48`

**Description:** `workspace/` is listed twice in `.gitignore`.

**Suggested Fix:** Remove the duplicate entry.

### 4.7 PostCSS Config Uses ES Module Syntax

**Location:** `postcss.config.js`

**Description:** Uses `export default` but file extension is `.js`. While this works with `"type": "module"` in package.json, it's cleaner to use `.mjs` or `.cjs` extension.

**Suggested Fix:** Rename to `postcss.config.mjs` or keep as-is (works fine).

### 4.8 Storybook Main Config Missing TypeScript Declaration

**Location:** `.storybook/main.ts`

**Description:** Storybook config could benefit from explicit TypeScript preset configuration.

**Suggested Fix:** Add TypeScript configuration:
```typescript
const config: StorybookConfig = {
  // ...existing config
  typescript: {
    check: true,
    reactDocgen: 'react-docgen-typescript',
  },
};
```

### 4.9 Version.json Has Static Build Date

**Location:** `version.json`

**Description:** The build date is static ("2025-01-07T00:00:00Z"). This should be updated during builds.

**Impact:** Build date doesn't reflect actual build time.

**Suggested Fix:** CI workflows already update this during release; ensure local builds also update it.

---

## 5. Dependency Audit

### 5.1 Frontend Dependencies (package.json)

| Category | Status | Notes |
|----------|--------|-------|
| React ecosystem | Good | React 19.2.3 (latest), React Router 6.30.1 |
| UI Components | Good | Radix UI components up-to-date |
| State Management | Good | TanStack Query 5.83.0 (latest) |
| Build Tools | Good | Vite 7.2.7 (latest), TypeScript 5.8.3 |
| Testing | Good | Vitest 4.0.16, Playwright 1.57.0 |
| Electron | Good | Electron 40.0.0 (latest stable) |

**Potential Security Issues:** None detected in direct dependencies.

**Outdated Dependencies:** None significant (all major versions current).

### 5.2 Backend Dependencies (requirements.txt)

| Package | Version Specified | Status |
|---------|-------------------|--------|
| fastapi | >=0.115.0 | Good (current: 0.115.x) |
| uvicorn | >=0.34.0 | Good |
| pydantic | >=2.10.0 | Good |
| pyinstaller | >=6.12.0 | Good |
| httpx | >=0.27.0 | Good |

**Recommendation:** Consider pinning exact versions for production builds to ensure reproducibility:
```
fastapi==0.115.0
uvicorn[standard]==0.34.0
```

### 5.3 DevDependency Analysis

| Package | Purpose | Status |
|---------|---------|--------|
| @chromatic-com/storybook | Chromatic integration | OK |
| @storybook/addon-vitest | Vitest integration | OK |
| @vitest/browser-playwright | Browser testing | OK but may conflict with standalone Playwright |

**Note:** Having both `@playwright/test` and `@vitest/browser-playwright` may cause version conflicts. Consider using one approach.

---

## 6. Build Configuration Analysis

### 6.1 Vite Configuration (vite.config.ts)

**Strengths:**
- Proper Electron mode detection
- Correct base path handling for file:// protocol
- Good proxy configuration for development

**Issues Found:**
- Sourcemap generation logic could be cleaner

**Recommendation:**
```typescript
// Current
sourcemap: mode === "development",

// Suggested (also enable for staging)
sourcemap: mode !== "production",
```

### 6.2 Electron Builder Configuration (electron-builder.yml)

**Strengths:**
- Multi-platform support (Windows, macOS, Linux)
- Proper entitlements for macOS
- NSIS installer configuration

**Issues Found:**
- No publish configuration (commented out)
- Missing Windows code signing configuration
- Icon paths may be incorrect (`public/nirs4all.ico` vs `public/icon.png`)

**Recommendations:**
1. Enable publish configuration for auto-updates
2. Add code signing documentation
3. Verify icon file existence and paths

### 6.3 PyInstaller Configuration (backend.spec)

**Strengths:**
- Proper GPU/CPU flavor handling
- Correct hidden imports for FastAPI
- Size optimization with exclusions

**Issues Found:**
- Missing some potential hidden imports for nirs4all library
- Build info file creation/cleanup in spec file

**Recommendation:** Add nirs4all-specific hidden imports:
```python
hiddenimports.extend([
    'nirs4all.api',
    'nirs4all.pipeline',
    'nirs4all.data',
])
```

---

## 7. CI/CD Recommendations

### 7.1 Workflow Consolidation

The project has 5 separate workflows with some overlap:
- `ci.yml` - Basic CI checks
- `pre-release.yml` - Pre-release validation
- `release.yml` - Full release build
- `electron-release.yml` - Electron-specific release
- `playwright.yml` - E2E tests

**Recommendation:** Consider consolidating:
1. Merge `release.yml` and `electron-release.yml` (both triggered by tags)
2. Run Playwright tests as part of `ci.yml` instead of separate workflow

### 7.2 Missing Workflow Features

| Feature | Status | Recommendation |
|---------|--------|----------------|
| Dependency caching | Partial | Use npm caching consistently |
| Artifact retention | Short (1-5 days) | Increase for release artifacts |
| Branch protection rules | Not configured | Add required checks |
| Dependabot | Missing | Add `dependabot.yml` |
| Security scanning | Missing | Add CodeQL workflow |
| Release drafts | Not configured | Enable auto-generated release notes |

### 7.3 Suggested New Workflow: Dependabot

Create `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      dev-dependencies:
        dependency-type: "development"

  - package-ecosystem: "pip"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 7.4 Suggested New Workflow: Security Scanning

Create `.github/workflows/security.yml`:
```yaml
name: Security

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'

jobs:
  codeql:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript, python
      - uses: github/codeql-action/analyze@v3
```

---

## 8. Environment Handling

### 8.1 Current Environment Variables

| Variable | Used In | Purpose |
|----------|---------|---------|
| `ELECTRON` | vite.config.ts | Enable Electron build mode |
| `NODE_ENV` | Various | production/development |
| `VITE_DEV_SERVER_URL` | electron/main.ts | Vite dev server URL (auto-set) |
| `NIRS4ALL_DESKTOP` | main.py | Desktop mode flag |
| `NIRS4ALL_PORT` | main.py | Backend port |
| `NIRS4ALL_PRODUCTION` | launcher scripts | Production mode flag |
| `NIRS4ALL_WORKSPACE` | main.py | Workspace path |
| `NIRS4ALL_BUILD_FLAVOR` | backend.spec | Build flavor (cpu/gpu) |

### 8.2 Missing Environment Files

| File | Status | Recommendation |
|------|--------|----------------|
| `.env` | Not committed | OK (contains secrets) |
| `.env.example` | Missing | Create template |
| `.env.development` | Missing | Consider adding |
| `.env.production` | Missing | Consider adding |

**Suggested `.env.example`:**
```bash
# nirs4all webapp environment variables

# Backend
NIRS4ALL_PORT=8000
NIRS4ALL_WORKSPACE=/path/to/workspace

# Optional: Override venv location
# NIRS4ALL_VENV=/path/to/venv
```

### 8.3 Production Configuration

**Missing:**
- No production-specific configuration file
- No environment validation at startup
- No secrets management documentation

**Recommendation:** Add environment validation in `main.py`:
```python
def validate_environment():
    """Validate required environment variables."""
    required = []  # Add required vars if any
    missing = [var for var in required if not os.environ.get(var)]
    if missing:
        raise EnvironmentError(f"Missing required environment variables: {missing}")
```

---

## 9. Scripts Analysis

### 9.1 Launcher Scripts (launcher.sh, launcher.cmd)

**Strengths:**
- Comprehensive functionality (start, stop, restart, clean, status)
- Interactive menu option
- Proper port management
- Log file handling

**Issues:**
- launcher.sh uses hardcoded venv path relative to project
- launcher.cmd doesn't handle all edge cases as robustly as .sh
- No timeout handling for service startup

### 9.2 Build Scripts (build-backend.cjs, build-release.cjs)

**Strengths:**
- Cross-platform support
- Proper argument parsing
- Clean error handling

**Issues:**
- build-backend.cjs references local .venv, not shared venv
- No version bump automation
- No changelog generation

### 9.3 Validation Scripts

| Script | Purpose | Status |
|--------|---------|--------|
| validate-nodes.cjs | Node definition validation | Good |
| validate-node-registry.cjs | Registry validation | Good |
| ensure-linux-node.cjs | WSL detection | Good |
| check-registry-snapshot.cjs | Snapshot testing | Good |

---

## 10. File-by-File Findings

### package.json

| Line | Finding | Severity |
|------|---------|----------|
| 8 | `packageManager` set but npm 10.9.4 may not match CI | Minor |
| 29 | Build script runs validate:nodes - good | Info |
| 69-124 | Dependencies well-organized | Good |
| 126-163 | DevDependencies complete | Good |

### tsconfig.json

| Line | Finding | Severity |
|------|---------|----------|
| 13 | `noUnusedParameters: false` - consider enabling | Minor |
| 16 | `noUnusedLocals: false` - consider enabling | Minor |

### vite.config.ts

| Line | Finding | Severity |
|------|---------|----------|
| 40-42 | Electron onstart uses --no-sandbox (OK for WSL) | Info |
| 95 | Sourcemap only in development | Minor |

### tailwind.config.ts

| Line | Finding | Severity |
|------|---------|----------|
| 90-106 | First accordion keyframe definition | Info |
| 141-156 | Duplicate accordion keyframe definition | Minor |
| 165-166 | Duplicate animation definition | Minor |
| 173 | Uses require() for plugin (CJS style) | Info |

### electron-builder.yml

| Line | Finding | Severity |
|------|---------|----------|
| 4 | Hardcoded copyright year 2024 | Minor |
| 32 | Windows icon path should be verified | Minor |
| 56-60 | macOS entitlements properly configured | Good |
| 99-103 | Publish configuration commented out | Info |

### playwright.config.ts

| Line | Finding | Severity |
|------|---------|----------|
| 44 | globalSetup references may not exist | Minor |
| 85-86 | Unix-only venv path | Major |

### .github/workflows/ci.yml

| Line | Finding | Severity |
|------|---------|----------|
| 45 | Tests continue on error | Major |
| 77-82 | GTK dependencies installed (good) | Info |
| 155-157 | Backend build uses direct PyInstaller | Info |

### .github/workflows/release.yml

| Line | Finding | Severity |
|------|---------|----------|
| 131 | References nirs4all-webapp.spec (wrong) | Critical |
| 178 | References nirs4all-webapp.spec (wrong) | Critical |
| 255 | References nirs4all-webapp.spec (wrong) | Critical |
| 307 | References nirs4all-webapp.spec (wrong) | Critical |

### .github/workflows/playwright.yml

| Line | Finding | Severity |
|------|---------|----------|
| 14 | Uses `lts/*` instead of specific version | Major |
| 21 | No backend startup before tests | Major |

### main.py

| Line | Finding | Severity |
|------|---------|----------|
| 96-100 | CORS allows all origins (OK for local dev) | Info |
| 127-128 | Uses deprecated @app.on_event decorator | Minor |

### README.md

| Line | Finding | Severity |
|------|---------|----------|
| 73-78 | References non-existent scripts | Major |
| 108-114 | References non-existent scripts | Major |
| 343-354 | Script table has wrong script names | Major |

### .gitignore

| Line | Finding | Severity |
|------|---------|----------|
| 29 | package-lock.json ignored (questionable) | Minor |
| 41, 48 | Duplicate workspace/ entries | Minor |

---

## 11. Action Items by Priority

### Immediate (Before Release)

1. **Fix release.yml spec file references** - Change `nirs4all-webapp.spec` to `backend.spec`
2. **Update README.md** - Fix script references to match actual files
3. **Add vitest.config.ts** - Ensure tests run properly

### Short-Term (This Sprint)

4. **Fix Playwright config** - Add Windows path support
5. **Standardize venv location** - Update build-backend.cjs
6. **Add orjson to requirements-cpu.txt**
7. **Remove duplicate Tailwind definitions**
8. **Fix CI test continue-on-error**
9. **Standardize Node.js version in Playwright workflow**

### Medium-Term (Next Sprint)

10. **Create .env.example**
11. **Add Dependabot configuration**
12. **Add security scanning workflow**
13. **Update copyright year**
14. **Consider committing package-lock.json**
15. **Add environment validation**

### Long-Term (Backlog)

16. **Consolidate CI workflows**
17. **Enable publish configuration in electron-builder.yml**
18. **Add code signing documentation**
19. **Improve Storybook TypeScript configuration**
20. **Pin Python dependencies for production**

---

## 12. Appendix: Configuration File Inventory

| File | Purpose | Last Modified |
|------|---------|---------------|
| `package.json` | Node.js project config | Current |
| `tsconfig.json` | TypeScript base config | Current |
| `tsconfig.app.json` | App TypeScript config | Current |
| `tsconfig.node.json` | Node TypeScript config | Current |
| `vite.config.ts` | Vite build config | Current |
| `tailwind.config.ts` | Tailwind CSS config | Current |
| `postcss.config.js` | PostCSS config | Current |
| `eslint.config.js` | ESLint config | Current |
| `electron-builder.yml` | Electron packaging | Current |
| `components.json` | shadcn/ui config | Current |
| `.nvmrc` | Node version file | Current |
| `requirements.txt` | Python base deps | Current |
| `requirements-cpu.txt` | CPU-only deps | Current |
| `requirements-gpu.txt` | GPU deps | Current |
| `requirements-gpu-macos.txt` | macOS GPU deps | Current |
| `backend.spec` | PyInstaller config | Current |
| `playwright.config.ts` | E2E test config | Current |
| `.storybook/main.ts` | Storybook config | Current |
| `.storybook/preview.ts` | Storybook preview | Current |
| `.gitignore` | Git ignore rules | Current |
| `version.json` | App version info | Current |

---

*End of Configuration and CI/CD Review*
