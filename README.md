# nirs4all Studio

**Unified NIRS Analysis Desktop Application**

A modern desktop application for Near-Infrared Spectroscopy (NIRS) data analysis, combining the power of the nirs4all Python library with a sleek React-based user interface.

## Features

- 📊 **Spectral Data Visualization** - Interactive charts for exploring NIRS spectra
- 🔬 **Pipeline Builder** - Visual drag-and-drop pipeline construction
- 🎯 **Prediction Engine** - Run trained models on new samples
- 📁 **Workspace Management** - Organize datasets, pipelines, and results
- 🖥️ **Native Desktop Experience** - Runs as a standalone desktop app via Electron
- ⚡ **GPU Acceleration** - CUDA (Linux/Windows) and Metal (macOS) support

## Tech Stack

### Frontend
- **React 19** with TypeScript (strict mode)
- **Vite** for fast development and optimized builds
- **Tailwind CSS** with custom scientific design system
- **shadcn/ui** component library
- **TanStack Query** for API state management
- **Framer Motion** for smooth animations

### Desktop Shell
- **Electron 40** for cross-platform desktop experience
- **Chromium** for consistent WebGL support across all platforms
- **IPC Bridge** for secure main/renderer communication

### Backend
- **FastAPI** for high-performance REST API
- **nirs4all** Python library for NIRS analysis
- **PyInstaller** for standalone backend packaging

## Getting Started

### Prerequisites

- Node.js 20+ (recommended: use `nvm` + the version in `.nvmrc`)
- Python 3.11+
- nirs4all library (optional for UI development)

### Cross-Platform Support

This project supports development on:
- **Windows Native** - PowerShell, cmd.exe, or Windows Terminal
- **Linux** - Any distribution with Node.js and Python
- **macOS** - Intel and Apple Silicon
- **WSL2** - Windows Subsystem for Linux

---

### Windows Native Setup

1. **Install Node dependencies:**
   ```cmd
   npm install
   ```

2. **Install Python dependencies:**
   ```cmd
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements-cpu.txt
   ```

3. **Start development servers:**

   Option A - Use the convenience scripts:
   ```cmd
   scripts\dev-full.cmd      REM Start frontend + backend together
   scripts\dev-start.cmd     REM Start frontend only
   scripts\dev-backend.cmd   REM Start backend only
   scripts\dev-electron.cmd  REM Start Electron desktop app
   ```

   Option B - Use npm scripts:
   ```cmd
   npm run dev          REM Frontend (Vite) at http://localhost:5173
   npm run dev:electron REM Electron desktop mode
   ```

   Terminal 2 (if running separately):
   ```cmd
   .venv\Scripts\activate
   python -m uvicorn main:app --reload --port 8000
   ```

---

### Linux / macOS Setup

1. **Install Node dependencies:**
   ```bash
   npm install
   ```

2. **Install Python dependencies:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements-cpu.txt  # or requirements-gpu.txt for GPU
   ```

3. **Start development servers:**

   Option A - Use the convenience scripts:
   ```bash
   ./scripts/dev-full.sh      # Start frontend + backend together
   ./scripts/dev-start.sh     # Start frontend only
   ./scripts/dev-backend.sh   # Start backend only
   ./scripts/dev-electron.sh  # Start Electron desktop app
   ```

   Option B - Use npm scripts:
   ```bash
   npm run dev          # Frontend (Vite) at http://localhost:5173
   npm run dev:electron # Electron desktop mode
   ```

---

### WSL2 Setup (Windows Subsystem for Linux)

If you prefer using WSL2, make sure you're using Linux `node`/`npm` (not the Windows ones mounted under `/mnt/c`).

1. **One-time: permanently disable Windows PATH injection into WSL** (prevents UNC/cmd.exe install failures):
   ```bash
   sudo tee /etc/wsl.conf <<'EOF'
   [interop]
   appendWindowsPath=false
   EOF
   ```
   Then restart WSL from Windows:
   ```powershell
   wsl.exe --shutdown
   ```

2. **Install/use Node via nvm (WSL-native):**
   ```bash
   npm run setup:wsl
   nvm use
   ```

Quick check (should NOT point to `/mnt/c/...`):
```bash
which node
which npm
```

Then follow the Linux setup instructions above.

---

### Desktop Mode (Electron)

To run as a desktop application:

```bash
# Development mode (with hot reload)
npm run dev:electron

# Build and preview (production mode)
npm run electron:preview
```

The Electron main process automatically spawns the Python backend and manages its lifecycle.

## Project Structure

```
nirs4all-studio/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   │   ├── layout/         # App layout (sidebar, header)
│   │   ├── pipeline-editor/# Pipeline Editor (see Architecture)
│   │   └── ui/             # shadcn/ui components
│   ├── context/            # React context providers
│   ├── data/               # Data models and registries
│   │   └── nodes/          # Node registry system
│   ├── lib/                # Utilities and helpers
│   ├── api/                # API client
│   ├── types/              # TypeScript type definitions
│   │   └── electron.d.ts   # Electron IPC types
│   └── pages/              # Route components
├── electron/               # Electron main process
│   ├── main.ts             # Main entry point (window management)
│   ├── preload.ts          # Secure IPC bridge (contextBridge)
│   └── backend-manager.ts  # Python backend lifecycle management
├── api/                    # FastAPI backend
│   ├── workspace.py        # Workspace management routes
│   ├── datasets.py         # Dataset operations
│   ├── pipelines.py        # Pipeline CRUD
│   ├── predictions.py      # Prediction storage
│   └── system.py           # Health, system info, and GPU detection
├── scripts/                # Build and utility scripts
│   ├── build-backend.cjs   # Python backend packaging (cross-platform)
│   ├── build-release.cjs   # Full release build (cross-platform)
│   ├── dev-start.cmd/.sh   # Start frontend dev server
│   ├── dev-backend.cmd/.sh # Start Python backend
│   ├── dev-electron.cmd/.sh# Start Electron desktop mode
│   └── dev-full.cmd/.sh    # Start frontend + backend together
├── build/                  # Build configuration
│   └── entitlements.mac.plist  # macOS code signing entitlements
├── docs/                   # Documentation
│   └── _internals/         # Developer guides
├── public/                 # Static assets
├── main.py                 # FastAPI application entry
├── backend.spec            # PyInstaller spec file
├── electron-builder.yml    # Electron packaging config
└── package.json            # Node dependencies
```

## Pipeline Editor Architecture

The Pipeline Editor is a visual pipeline builder for nirs4all workflows. It follows a modular architecture for maintainability and extensibility.

### Core Components

```
src/components/pipeline-editor/
├── config/                     # Configuration panel
│   └── step-renderers/         # Type-specific renderers
│       ├── DefaultRenderer.tsx # Standard algorithm + params
│       ├── ModelRenderer.tsx   # Model-specific UI
│       ├── MergeRenderer.tsx   # Merge step UI
│       └── ...
├── shared/                     # Reusable UI components
│   ├── ParameterInput.tsx      # Number/text inputs
│   ├── ParameterSelect.tsx     # Dropdown select
│   ├── ParameterSwitch.tsx     # Boolean toggle
│   ├── CollapsibleSection.tsx  # Expandable sections
│   ├── InfoTooltip.tsx         # Help tooltips
│   └── ValidationMessage.tsx   # Error/warning display
├── validation/                 # Validation system
│   ├── engine.ts               # Core validation engine
│   ├── parameterValidator.ts   # Parameter validation
│   ├── stepValidator.ts        # Step validation
│   ├── pipelineValidator.ts    # Pipeline structure
│   ├── rules.ts                # Validation rules registry
│   ├── useValidation.ts        # React hook
│   ├── ValidationPanel.tsx     # Issues display
│   └── ValidationContext.tsx   # React context
└── types.ts                    # Shared TypeScript types
```

### Node Registry System

```
src/data/nodes/
├── definitions/           # Node definitions (JSON)
│   ├── preprocessing/     # Preprocessing nodes
│   ├── models/            # Model nodes
│   ├── splitting/         # CV splitters
│   └── ...
├── custom/                # Custom node system
│   └── CustomNodeStorage.ts  # User-defined nodes
├── categories/            # Category configuration
├── NodeRegistry.ts        # Runtime registry
├── types.ts               # TypeScript types
└── index.ts               # Public API
```

### Key Design Patterns

| Pattern | Location | Purpose |
|---------|----------|---------|
| Registry | `NodeRegistry.ts` | Central node definition lookup |
| Validator | `validation/` | Multi-level validation with rules |
| Context | `ValidationContext.tsx` | Shared validation state |
| Factory | `step-renderers/` | Type-specific UI rendering |
| Singleton | `CustomNodeStorage` | Persistent custom nodes |

### Validation System

The validation system provides multi-level validation:

1. **Parameter Level**: Type checking, range validation, required fields
2. **Step Level**: Step structure, container validation
3. **Pipeline Level**: Model presence, splitter ordering, structure

```typescript
import { validate, useValidation } from './validation';

// Direct validation
const result = validate(steps, { strictMode: true });
console.log(result.isValid, result.errors);

// React hook (debounced)
const { isValid, errorCount, getStepIssues } = useValidation(steps);
```

### Custom Nodes

Users can define custom operators:

```typescript
import { CustomNodeStorage } from '@/data/nodes/custom';

const storage = CustomNodeStorage.getInstance();
storage.add({
  id: 'custom.my_transform',
  name: 'MyTransform',
  type: 'preprocessing',
  classPath: 'mypackage.MyTransform',
  description: 'Custom transform',
  source: 'custom',
  parameters: [/* ... */]
});
```

See [developer_guide_custom_nodes.md](docs/_internals/developer_guide_custom_nodes.md) for details.

### Test Coverage

| Area | Tests | Coverage |
|------|-------|----------|
| Shared Components | 231 | Unit tests for all props/states |
| Step Renderers | 87 | Renderer-specific behavior |
| Validation | 143 | Integration + unit tests |
| Custom Nodes | 82 | E2E workflow tests |

Run tests:
```bash
npm run test               # All tests
npm run test:coverage      # With coverage report
npm run test:ui            # Interactive UI
```

### Storybook

Component documentation with Storybook:

```bash
npm run storybook          # Development server (port 6006)
npm run build-storybook    # Build static docs
```

Stories are located in `__stories__/` directories next to components.

## Scripts

### Convenience Scripts (Cross-Platform)

These scripts work on both Windows (.cmd) and Linux/macOS (.sh):

| Windows | Linux/macOS | Description |
|---------|-------------|-------------|
| `scripts\dev-start.cmd` | `./scripts/dev-start.sh` | Start frontend dev server |
| `scripts\dev-backend.cmd` | `./scripts/dev-backend.sh` | Start Python backend |
| `scripts\dev-electron.cmd` | `./scripts/dev-electron.sh` | Start Electron desktop mode |
| `scripts\dev-full.cmd` | `./scripts/dev-full.sh` | Start frontend + backend together |

### npm Scripts - Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run dev:electron` | Start Electron with hot reload |
| `npm run dev:registry` | Start with node registry enabled |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run storybook` | Start Storybook dev server |

### npm Scripts - Production Builds

| Command | Description |
|---------|-------------|
| `npm run build` | Build frontend for production |
| `npm run build:electron` | Build Electron app |
| `npm run electron:preview` | Preview Electron production build |
| `npm run build:backend` | Build Python backend (CPU, default) |
| `npm run build:backend:cpu` | Build Python backend (CPU) |
| `npm run build:backend:gpu` | Build Python backend (GPU/CUDA) |
| `npm run build:backend:gpu-metal` | Build Python backend (GPU/Metal for macOS) |
| `npm run build:backend:clean` | Clean and rebuild backend |
| `npm run build:release` | Full release build (CPU, current platform) |
| `npm run build:release:cpu` | Full release build (CPU edition) |
| `npm run build:release:gpu` | Full release build (GPU edition) |
| `npm run build:release:clean` | Clean and rebuild release |
| `npm run build:release:all` | Build for all platforms |

### npm Scripts - Packaging

| Command | Description |
|---------|-------------|
| `npm run electron:build` | Package for current platform |
| `npm run build:release --platform win` | Package for Windows |
| `npm run build:release --platform mac` | Package for macOS |
| `npm run build:release --platform linux` | Package for Linux |
| `npm run build:release --platform all` | Package for all platforms |

## Design System

The application uses a teal/cyan scientific theme inspired by spectral-explorer, featuring:

- **Glass morphism** cards with backdrop blur
- **Glow effects** for interactive elements
- **Dark/Light mode** with smooth transitions
- **Inter + JetBrains Mono** typography

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ELECTRON.md](docs/ELECTRON.md) | Electron architecture and development guide |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Build system, CI/CD, and release process |
| [docs/UPDATE_SYSTEM.md](docs/UPDATE_SYSTEM.md) | Auto-updater implementation |
| [docs/sources/custom-nodes-guide.md](docs/sources/custom-nodes-guide.md) | Custom node development |

## License

See the nirs4all project for license information.
