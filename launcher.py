"""
PyInstaller entry point for nirs4all-webapp backend.

Handles frozen-bundle concerns (sys._MEIPASS, working directory) then
delegates to the FastAPI app defined in main.py.

This file is referenced by nirs4all-webapp.spec (line 228) and built by
the release/pre-release CI workflows.
"""

import os
import sys


def main():
    # When running from a PyInstaller bundle, sys._MEIPASS points to the
    # temporary extraction directory.  Set the working directory and sys.path
    # so that relative imports (api/, websocket/) and static file paths
    # (dist/, public/) resolve correctly.
    if getattr(sys, "frozen", False):
        bundle_dir = sys._MEIPASS
        os.chdir(bundle_dir)
        if bundle_dir not in sys.path:
            sys.path.insert(0, bundle_dir)

    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="nirs4all backend server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("NIRS4ALL_PORT", 8000)),
        help="Port to run the server on (default: 8000 or NIRS4ALL_PORT env var)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    args = parser.parse_args()

    # Import after path setup so api.* and websocket.* resolve correctly
    from main import app

    # Pass the app object directly (not the "main:app" string) because
    # reload is always disabled in production bundles.
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
