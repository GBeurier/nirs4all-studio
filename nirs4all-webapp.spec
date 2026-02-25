# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for nirs4all-webapp.

Build commands:
  Linux:   pyinstaller nirs4all-webapp.spec --clean
  Windows: pyinstaller nirs4all-webapp.spec --clean
  macOS:   pyinstaller nirs4all-webapp.spec --clean

Requirements:
  - Frontend must be built first: npm run build
  - version.json should be updated with build info
"""

import sys
from pathlib import Path

# Platform detection
is_windows = sys.platform == 'win32'
is_macos = sys.platform == 'darwin'
is_linux = sys.platform.startswith('linux')

# Base path (directory containing this spec file)
spec_dir = Path(SPECPATH)

# Application metadata
APP_NAME = 'nirs4all-webapp'

# ============================================================================
# Data files to bundle (non-Python files)
# ============================================================================
datas = [
    # Frontend build output (React app)
    (str(spec_dir / 'dist'), 'dist'),
    # Public assets (icons, robots.txt, etc.)
    (str(spec_dir / 'public'), 'public'),
    # Version information (updated by build script)
    (str(spec_dir / 'version.json'), '.'),
]

# ============================================================================
# Hidden imports - modules PyInstaller might not detect
# ============================================================================
hiddenimports = [
    # === FastAPI and ASGI ===
    'fastapi',
    'fastapi.middleware',
    'fastapi.middleware.cors',
    'fastapi.staticfiles',
    'fastapi.responses',
    'starlette',
    'starlette.routing',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.responses',
    'starlette.staticfiles',
    'starlette.websockets',

    # === Uvicorn (ASGI server) ===
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',

    # === Pydantic ===
    'pydantic',
    'pydantic_core',
    'pydantic_settings',
    'annotated_types',

    # === HTTP/Network ===
    'httpx',
    'httpcore',
    'h11',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',

    # === Async support ===
    'anyio',
    'anyio._backends',
    'anyio._backends._asyncio',
    'sniffio',

    # === File handling ===
    'multipart',
    'python_multipart',

    # === Configuration ===
    'yaml',
    'platformdirs',

    # === PyWebView ===
    'webview',

    # === Email validation (pydantic dependency) ===
    'email_validator',

    # === API modules (explicit imports) ===
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

    # === WebSocket modules ===
    'websocket',
    'websocket.manager',

    # === Updater modules ===
    'updater',
]

# Platform-specific hidden imports
if is_linux:
    hiddenimports.extend([
        # GTK/WebKit2 for pywebview on Linux
        'gi',
        'gi.repository',
        'gi.repository.Gtk',
        'gi.repository.GLib',
        'gi.repository.Gio',
        'gi.repository.GObject',
        'gi.repository.WebKit2',
        'cairo',
        'pycairo',
        'webview.platforms.gtk',
    ])
elif is_macos:
    hiddenimports.extend([
        # Cocoa for pywebview on macOS
        'webview.platforms.cocoa',
        'Foundation',
        'AppKit',
        'WebKit',
        'objc',
        'PyObjCTools',
    ])
elif is_windows:
    hiddenimports.extend([
        # EdgeChromium for pywebview on Windows
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'webview.platforms.cef',
        'clr',
        'pythonnet',
    ])

# ============================================================================
# Excludes - packages NOT to bundle (managed separately via venv)
# ============================================================================
excludes = [
    # nirs4all library (installed in managed venv)
    'nirs4all',

    # Deep learning frameworks (installed on demand)
    'tensorflow',
    'tf_keras',
    'torch',
    'torchvision',
    'torchaudio',
    'jax',
    'jaxlib',
    'flax',
    'keras',

    # Scientific computing (part of nirs4all)
    'sklearn',
    'scikit-learn',
    'scipy',
    'numpy',
    'pandas',
    'polars',

    # Visualization (part of nirs4all)
    'matplotlib',
    'seaborn',
    'plotly',

    # Other heavy dependencies
    'IPython',
    'jupyter',
    'notebook',
    'pytest',
    'sphinx',

    # CUDA libraries
    'cuda',
    'cudnn',
    'tensorrt',
]

# ============================================================================
# Analysis
# ============================================================================
a = Analysis(
    [str(spec_dir / 'launcher.py')],
    pathex=[str(spec_dir)],
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

# ============================================================================
# Filter out unwanted large binaries
# ============================================================================
exclude_binary_patterns = [
    'libcudart',
    'libcublas',
    'libcufft',
    'libcurand',
    'libcusparse',
    'libcusolver',
    'libnvrtc',
    'libnccl',
    'torch',
    'tensorflow',
    'libnvidia',
    'libcuda',
]

a.binaries = [
    (name, path, typ) for name, path, typ in a.binaries
    if not any(pattern in name.lower() for pattern in exclude_binary_patterns)
]

# ============================================================================
# PYZ archive (compiled Python modules)
# ============================================================================
pyz = PYZ(a.pure)

# ============================================================================
# Executable
# ============================================================================
exe_kwargs = {
    'name': APP_NAME,
    'debug': False,
    'bootloader_ignore_signals': False,
    'strip': False,
    'upx': True,
    'console': False,  # No console window (GUI app)
    'disable_windowed_traceback': False,
    'argv_emulation': False,
    'target_arch': None,
    'codesign_identity': None,
    'entitlements_file': None,
}

# Icon handling
icon_path = spec_dir / 'public' / 'nirs4all_icon.svg'
if is_windows:
    # Windows needs .ico file
    ico_path = spec_dir / 'public' / 'nirs4all_icon.ico'
    if ico_path.exists():
        exe_kwargs['icon'] = str(ico_path)
elif is_macos:
    # macOS needs .icns file
    icns_path = spec_dir / 'public' / 'nirs4all_icon.icns'
    if icns_path.exists():
        exe_kwargs['icon'] = str(icns_path)
# Linux doesn't use icon in exe

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    **exe_kwargs,
)

# ============================================================================
# Collect all files into distribution folder
# ============================================================================
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name=APP_NAME,
)

# ============================================================================
# macOS: Create .app bundle
# ============================================================================
if is_macos:
    app = BUNDLE(
        coll,
        name=f'{APP_NAME}.app',
        icon=str(spec_dir / 'public' / 'nirs4all_icon.icns') if (spec_dir / 'public' / 'nirs4all_icon.icns').exists() else None,
        bundle_identifier='com.nirs4all.webapp',
        info_plist={
            'CFBundleName': 'nirs4all',
            'CFBundleDisplayName': 'nirs4all - NIRS Analysis Workbench',
            'CFBundleGetInfoString': 'nirs4all Desktop Application',
            'CFBundleIdentifier': 'com.nirs4all.webapp',
            'CFBundleVersion': '1.0.0',
            'CFBundleShortVersionString': '1.0.0',
            'NSHighResolutionCapable': True,
            'NSRequiresAquaSystemAppearance': False,  # Support dark mode
            'LSMinimumSystemVersion': '10.15',
            'LSApplicationCategoryType': 'public.app-category.developer-tools',
        },
    )
