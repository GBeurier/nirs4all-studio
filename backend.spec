# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for nirs4all backend.

This packages the FastAPI backend as a standalone executable
that can be spawned by the Electron main process.

Usage:
    # CPU build (default)
    pyinstaller backend.spec --noconfirm

    # GPU build
    NIRS4ALL_BUILD_FLAVOR=gpu pyinstaller backend.spec --noconfirm

Output:
    dist/nirs4all-backend (Linux/macOS)
    dist/nirs4all-backend.exe (Windows)
"""

import os
import sys
from pathlib import Path

# Determine platform-specific settings
is_windows = sys.platform == 'win32'
is_macos = sys.platform == 'darwin'
is_linux = sys.platform.startswith('linux')

# Build flavor: 'cpu', 'gpu' (CUDA), or 'gpu-metal' (macOS)
BUILD_FLAVOR = os.environ.get('NIRS4ALL_BUILD_FLAVOR', 'cpu').lower()
IS_GPU_BUILD = BUILD_FLAVOR in ('gpu', 'gpu-metal')
IS_METAL_BUILD = BUILD_FLAVOR == 'gpu-metal'
IS_CUDA_BUILD = BUILD_FLAVOR == 'gpu'

print(f"Building nirs4all-backend ({BUILD_FLAVOR.upper()} flavor)")
if IS_METAL_BUILD:
    print("  -> macOS Metal GPU acceleration")
elif IS_CUDA_BUILD:
    print("  -> NVIDIA CUDA GPU acceleration")

# Project root
project_root = Path(SPECPATH)

# Create build info file
build_info = {
    'flavor': BUILD_FLAVOR,
    'gpu_enabled': IS_GPU_BUILD,
}

# Write build info to be bundled
build_info_path = project_root / 'build_info.json'
import json
with open(build_info_path, 'w') as f:
    json.dump(build_info, f)

# Collect data files
datas = [
    # Include the dist folder (built frontend) if it exists
    (str(project_root / 'dist'), 'dist'),
    # Include public assets
    (str(project_root / 'public'), 'public'),
    # Include build info
    (str(build_info_path), '.'),
    # Version information (for update detection)
    (str(project_root / 'version.json'), '.'),
]

# Filter out non-existent paths
datas = [(src, dst) for src, dst in datas if Path(src).exists()]

# Hidden imports that PyInstaller might miss
hiddenimports = [
    # FastAPI and dependencies
    'fastapi',
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'starlette',
    'starlette.routing',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.staticfiles',
    'starlette.responses',
    'pydantic',
    'pydantic_core',
    'pydantic.deprecated',
    'pydantic.deprecated.decorator',

    # API modules (all routers)
    'api',
    'api.aggregated_predictions',
    'api.analysis',
    'api.app_config',
    'api.automl',
    'api.datasets',
    'api.evaluation',
    'api.inspector',
    'api.lazy_imports',
    'api.models',
    'api.nirs4all_adapter',
    'api.pipelines',
    'api.playground',
    'api.predictions',
    'api.preprocessing',
    'api.projects',
    'api.recommended_config',
    'api.runs',
    'api.shap',
    'api.spectra',
    'api.store_adapter',
    'api.synthesis',
    'api.system',
    'api.training',
    'api.transfer',
    'api.update_downloader',
    'api.updates',
    'api.venv_manager',
    'api.workspace',
    'api.workspace_manager',
    'api.jobs',
    'api.jobs.manager',
    'api.shared',
    'api.shared.decimation',
    'api.shared.filter_operators',
    'api.shared.logger',
    'api.shared.metrics_computer',
    'api.shared.pipeline_service',

    # WebSocket support
    'websocket',
    'websocket.manager',
    'websockets',

    # Updater module
    'updater',

    # Additional utilities
    'multipart',
    'python_multipart',
    'httpx',
    'yaml',
    'packaging',
    'platformdirs',
    'orjson',

    # nirs4all library (optional - will gracefully fail if not installed)
    'nirs4all',
]

# GPU-specific hidden imports
if IS_GPU_BUILD:
    hiddenimports.extend([
        # TensorFlow GPU support
        'tensorflow',
        'tensorflow.python',
        'tensorflow.python.client',
        'keras',
    ])

# macOS Metal-specific imports
if IS_METAL_BUILD:
    hiddenimports.extend([
        'tensorflow_metal',
    ])

# Packages to exclude (reduce size)
excludes = [
    'pywebview',  # Not needed in Electron mode
    'tkinter',
    'PIL',
    'IPython',
    'jupyter',
    'notebook',
    'sphinx',
    'pytest',
]

# CPU build: exclude heavy GPU libraries
if not IS_GPU_BUILD:
    excludes.extend([
        'tensorflow',
        'tensorflow_macos',
        'tensorflow_metal',
        'keras',
        'tensorboard',
        'torch',
        'jax',
        'jaxlib',
    ])

# CUDA build on non-macOS: exclude Metal-specific packages
if IS_CUDA_BUILD and not is_macos:
    excludes.extend([
        'tensorflow_macos',
        'tensorflow_metal',
    ])

# Analysis
a = Analysis(
    [str(project_root / 'main.py')],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

# Remove unnecessary files to reduce size
a.datas = [x for x in a.datas if not x[0].startswith('tcl')]
a.datas = [x for x in a.datas if not x[0].startswith('tk')]

pyz = PYZ(a.pure)

# Executable name includes flavor for GPU builds
exe_name = 'nirs4all-backend'

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=exe_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=str(project_root / 'build' / 'entitlements.mac.plist') if is_macos else None,
)

# Clean up build info file
if build_info_path.exists():
    build_info_path.unlink()
