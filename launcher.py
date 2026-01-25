"""
Desktop launcher for nirs4all webapp using pywebview.

This module creates a native desktop window using pywebview
that displays the React application, with native file dialogs
exposed via the JavaScript API.
"""

import os
import sys
import platform
import subprocess
import threading
import time
from pathlib import Path


def is_wsl() -> bool:
    """Check if running in Windows Subsystem for Linux."""
    try:
        with open("/proc/version", "r") as f:
            return "microsoft" in f.read().lower()
    except (FileNotFoundError, PermissionError):
        return False


def detect_gpu_support() -> bool:
    """Check if hardware GPU acceleration is available."""
    system = platform.system().lower()

    if system == "linux":
        # WSL2 has limited GPU support - GBM often unavailable
        if is_wsl():
            return False

        # Check for DRI devices first (fast check)
        if not Path("/dev/dri/card0").exists():
            return False

        # Verify actual rendering capability via glxinfo
        try:
            result = subprocess.run(
                ["glxinfo", "-B"],
                capture_output=True,
                text=True,
                timeout=3
            )
            if result.returncode == 0 and "direct rendering: Yes" in result.stdout:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        return False

    elif system == "darwin":
        return True  # macOS always has GPU acceleration

    elif system == "windows":
        return True  # Assume GPU available on Windows

    return False


def select_optimal_backend() -> str:
    """Select the best available pywebview backend for performance."""
    system = platform.system().lower()

    if system == "windows":
        # Prefer EdgeChromium (WebView2) on Windows - fastest option
        return "edgechromium"

    elif system == "darwin":
        # macOS: WKWebView via Cocoa is well-optimized
        return "cocoa"

    elif system == "linux":
        # Linux: Prefer Qt/Chromium if available (faster than GTK/WebKit2)
        # Qt uses Chromium's V8 engine, similar performance to Chrome
        try:
            from PyQt6.QtWebEngineWidgets import QWebEngineView
            return "qt"
        except ImportError:
            pass
        try:
            from PyQt5.QtWebEngineWidgets import QWebEngineView
            return "qt"
        except ImportError:
            pass
        # Fall back to GTK/WebKit2
        return "gtk"

    return "gtk"  # Default fallback


def configure_webview_environment():
    """Configure optimal pywebview environment based on platform and GPU."""
    # Select backend if not already set
    if "PYWEBVIEW_GUI" not in os.environ:
        backend = select_optimal_backend()
        os.environ["PYWEBVIEW_GUI"] = backend
        print(f"[launcher] Selected pywebview backend: {backend}")
    else:
        print(f"[launcher] Using configured backend: {os.environ['PYWEBVIEW_GUI']}")

    # Configure GPU/WebGL flags based on detection
    has_gpu = detect_gpu_support()
    if has_gpu:
        # Hardware GPU acceleration available
        # Use ANGLE with OpenGL ES backend for better compatibility (avoids Vulkan issues)
        os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS",
            "--enable-webgl "
            "--ignore-gpu-blocklist "
            "--enable-gpu-rasterization "
            "--enable-zero-copy "
            "--use-gl=angle "
            "--use-angle=gl "
            "--disable-vulkan"
        )
        print("[launcher] GPU detected - using hardware acceleration (OpenGL)")
    else:
        # Software rendering fallback
        os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS",
            "--disable-gpu"
        )
        print("[launcher] No GPU detected - using software rendering")


# Configure environment before importing webview
configure_webview_environment()

import webview


# Store window reference for API methods
window = None
backend_server = None


class Api:
    """API class to expose Python functions to JavaScript."""

    def resize_window(self, width: int, height: int):
        """Resize the window to specified dimensions."""
        global window
        if window:
            window.resize(width, height)
            return True
        return False

    def minimize_window(self):
        """Minimize the window."""
        global window
        if window:
            window.minimize()
            return True
        return False

    def maximize_window(self):
        """Toggle maximize/restore the window."""
        global window
        if window:
            # pywebview doesn't have a direct maximize method, use toggle_fullscreen
            # or resize to screen size
            try:
                window.toggle_fullscreen()
            except AttributeError:
                # Fallback: try to get screen size and resize
                pass
            return True
        return False

    def restore_window(self):
        """Restore the window from minimized/maximized state."""
        global window
        if window:
            window.restore()
            return True
        return False

    def get_window_size(self):
        """Get current window size."""
        global window
        if window:
            return {"width": window.width, "height": window.height}
        return None

    def is_desktop_mode(self):
        """Check if running in desktop mode (pywebview)."""
        return True

    def select_folder(self):
        """Open native folder picker dialog."""
        global window
        if not window:
            return None

        result = window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None

    def select_file(self, file_types=None, allow_multiple=False):
        """Open native file picker dialog."""
        global window
        if not window:
            print("[select_file] No window available")
            return None

        if file_types is None:
            file_types = ("JSON files (*.json)",)

        print(
            f"[select_file] Opening dialog with file_types={file_types}, allow_multiple={allow_multiple}"
        )
        result = window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=allow_multiple, file_types=file_types
        )
        print(f"[select_file] Dialog returned: {result}")

        # If multiple selection, return all files
        if allow_multiple and result:
            return list(result)
        # If single selection, return first file
        elif result and len(result) > 0:
            return result[0]
        return None

    def save_file(self, default_filename="pipeline.json", file_types=None):
        """Open native save file dialog."""
        global window
        if not window:
            print("[save_file] No window available")
            return None

        if file_types is None:
            file_types = ("JSON files (*.json)",)

        print(
            f"[save_file] Opening dialog with default_filename={default_filename}, file_types={file_types}"
        )
        result = window.create_file_dialog(
            webview.SAVE_DIALOG, save_filename=default_filename, file_types=file_types
        )
        print(f"[save_file] Dialog returned: {result} (type: {type(result)})")

        # SAVE_DIALOG returns a tuple like other dialogs
        if result:
            if isinstance(result, (list, tuple)) and len(result) > 0:
                path = result[0]
                print(f"[save_file] Extracted path from tuple: {path}")
                return path
            else:
                print(f"[save_file] Returning result directly: {result}")
                return result
        print("[save_file] No file selected")
        return None


def get_url():
    """Get the URL for the React app."""
    # In development, use Vite dev server
    if os.environ.get("VITE_DEV", "false").lower() == "true":
        return "http://localhost:5173"

    # In production, use the backend to serve static files
    return "http://127.0.0.1:8000"


def is_packaged():
    """Check if running as packaged executable."""
    return getattr(sys, "frozen", False)


def start_backend_server():
    """Start the FastAPI backend server in a separate thread."""
    try:
        import uvicorn

        # Suppress TensorFlow warnings
        os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
        os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

        # Get the correct path for the backend module
        if is_packaged():
            # When packaged, modules are in _internal directory
            base_path = Path(getattr(sys, "_MEIPASS", "."))
        else:
            # When running from source, use current directory
            base_path = Path(__file__).parent

        # Add the base path to sys.path so imports work
        if str(base_path) not in sys.path:
            sys.path.insert(0, str(base_path))

        # Change working directory to base_path for relative imports
        os.chdir(str(base_path))

        # Start uvicorn server
        uvicorn.run(
            "main:app",
            host="127.0.0.1",
            port=8000,
            log_level="warning",
            access_log=False,
        )
    except Exception as e:
        # Write error to log file in temp directory
        import tempfile
        import traceback

        log_file = Path(tempfile.gettempdir()) / "nirs4all_webapp_error.log"
        with open(log_file, "w", encoding="utf-8") as f:
            f.write(f"Backend startup error:\n{str(e)}\n")
            f.write(traceback.format_exc())
        print(f"Backend error logged to: {log_file}")
        raise


def main():
    """Launch the desktop application."""
    global window
    global backend_server

    # Determine if we're in production mode
    # Production mode is either when packaged OR when NIRS4ALL_PRODUCTION env is set
    is_prod = is_packaged() or os.environ.get("NIRS4ALL_PRODUCTION", "false").lower() == "true"
    is_dev = os.environ.get("VITE_DEV", "false").lower() == "true"
    # Only enable debug mode when explicitly requested (avoids WebKit inspector overhead)
    show_debug = os.environ.get("NIRS4ALL_DEBUG", "false").lower() == "true"

    # Start backend server in a separate thread (in production mode, not dev mode)
    backend_ready = False
    if is_prod and not is_dev:
        print("Starting embedded backend server...")
        backend_server = threading.Thread(target=start_backend_server, daemon=True)
        backend_server.start()

        # Wait for backend to be ready with retries
        print("Waiting for backend to initialize...")
        max_retries = 10
        for i in range(max_retries):
            time.sleep(1)
            try:
                import urllib.request

                urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=1)
                print("Backend ready!")
                backend_ready = True
                break
            except Exception as e:
                if i == max_retries - 1:
                    print(f"Warning: Backend not responding after {max_retries} seconds")
                    print(f"Last error: {e}")
                    print("Opening window anyway...")
                else:
                    print(f"Waiting... ({i + 1}/{max_retries})")
                continue

    # Wait for Vite dev server to be ready (when launched directly with VITE_DEV=true)
    if is_dev:
        import urllib.request

        print("Waiting for Vite dev server...")
        max_retries = 30  # Vite can take longer on first compile
        for i in range(max_retries):
            try:
                response = urllib.request.urlopen("http://127.0.0.1:5173", timeout=2)
                html = response.read().decode("utf-8", errors="ignore")
                # Verify Vite has finished compiling (page contains the root div)
                if '<div id="root">' in html:
                    print("Vite dev server ready!")
                    break
                # Page responding but not fully compiled yet
                print(f"Vite compiling... ({i + 1}/{max_retries})")
            except Exception:
                print(f"Waiting for Vite... ({i + 1}/{max_retries})")
            time.sleep(0.5)
        else:
            print("Warning: Vite dev server may not be fully ready")

    print(f"Opening application window (backend_ready={backend_ready})...")

    url = get_url()
    api = Api()

    # Determine base path for resources
    if is_packaged():
        base_path = Path(sys._MEIPASS)
    else:
        base_path = Path(__file__).parent

    # Find application icon
    icon_path = None
    icon_candidates = [
        base_path / "public" / "nirs4all_icon.ico",
        base_path / "public" / "nirs4all.ico",
        base_path / "public" / "nirs4all_icon.png",
        base_path / "public" / "nirs4all_icon.svg",
    ]

    for candidate in icon_candidates:
        if candidate.exists():
            icon_path = str(candidate)
            break

    if icon_path:
        print(f"Using application icon: {icon_path}")
    else:
        print("No application icon found; continuing without explicit icon")

    # Create window configuration
    create_kwargs = {
        "title": "nirs4all - NIRS Analysis Workbench",
        "url": url,
        "width": 1400,
        "height": 900,
        "resizable": True,
        "fullscreen": False,
        "min_size": (1024, 768),
        "js_api": api,
        "easy_drag": False,  # Don't use easy drag - it can interfere with normal interactions
    }

    # On Linux/WSL, explicitly set frameless to False to ensure native window decorations
    system = platform.system().lower()
    if system == "linux":
        create_kwargs["frameless"] = False
        if is_wsl():
            # WSL2/WSLg may need additional hints for proper window decoration
            print("[launcher] Running on WSL2 - using native window decorations")

    if icon_path:
        try:
            create_kwargs["icon"] = icon_path
        except Exception:
            pass

    try:
        window = webview.create_window(**create_kwargs)
    except TypeError as exc:
        if "icon" in create_kwargs:
            create_kwargs.pop("icon", None)
            print(f"create_window does not support 'icon' parameter ({exc}); retrying without icon.")
            window = webview.create_window(**create_kwargs)
        else:
            raise

    print("Starting webview...")
    webview.start(debug=show_debug)
    print("Webview closed.")


if __name__ == "__main__":
    main()
