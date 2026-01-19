#!/bin/bash
# Build complete nirs4all release (frontend + backend + Electron packaging)
#
# Usage:
#   ./scripts/build-release.sh [options]
#
# Options:
#   --flavor cpu|gpu   Build flavor (default: cpu)
#   --clean            Clean all build artifacts before building
#   --skip-backend     Skip building the Python backend (use existing)
#   --skip-frontend    Skip building the frontend (use existing)
#   --platform         Target platform: win, mac, linux, or all (default: current)
#
# Examples:
#   ./scripts/build-release.sh                         # CPU build for current platform
#   ./scripts/build-release.sh --flavor gpu            # GPU build
#   ./scripts/build-release.sh --platform all          # Build for all platforms
#   ./scripts/build-release.sh --flavor cpu --clean    # Clean CPU build

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "========================================"
echo "  nirs4all Release Build"
echo "========================================"
echo ""

# Default values
FLAVOR="cpu"
CLEAN=false
SKIP_BACKEND=false
SKIP_FRONTEND=false
PLATFORM=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --flavor)
            FLAVOR="$2"
            shift 2
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --skip-backend)
            SKIP_BACKEND=true
            shift
            ;;
        --skip-frontend)
            SKIP_FRONTEND=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate flavor
if [[ "$FLAVOR" != "cpu" && "$FLAVOR" != "gpu" ]]; then
    echo "Error: Invalid flavor '$FLAVOR'. Must be 'cpu' or 'gpu'."
    exit 1
fi

echo "Build configuration:"
echo "  Flavor: ${FLAVOR^^}"
echo "  Platform: ${PLATFORM:-current}"
echo ""

# Clean if requested
if [ "$CLEAN" = true ]; then
    echo "=== Cleaning build artifacts ==="
    rm -rf dist dist-electron backend-dist release build/nirs4all-backend
    echo "Clean complete"
    echo ""
fi

# Step 1: Build Python backend
if [ "$SKIP_BACKEND" = false ]; then
    echo "=== Step 1: Building Python backend (${FLAVOR^^}) ==="
    bash "$SCRIPT_DIR/build-backend.sh" --flavor "$FLAVOR"
    echo ""
else
    echo "=== Step 1: Skipping backend build ==="
    if [ ! -d "backend-dist" ] || [ -z "$(ls -A backend-dist 2>/dev/null)" ]; then
        echo "Error: backend-dist is empty but --skip-backend was specified"
        exit 1
    fi
    echo ""
fi

# Step 2: Build frontend (Vite + Electron)
if [ "$SKIP_FRONTEND" = false ]; then
    echo "=== Step 2: Building frontend ==="
    npm run build:electron
    echo ""
else
    echo "=== Step 2: Skipping frontend build ==="
    if [ ! -d "dist" ] || [ ! -d "dist-electron" ]; then
        echo "Error: dist or dist-electron not found but --skip-frontend was specified"
        exit 1
    fi
    echo ""
fi

# Step 3: Package with electron-builder
echo "=== Step 3: Packaging with electron-builder ==="

# Determine platform flags
PLATFORM_FLAGS=""
case "$PLATFORM" in
    win)
        PLATFORM_FLAGS="--win"
        ;;
    mac)
        PLATFORM_FLAGS="--mac"
        ;;
    linux)
        PLATFORM_FLAGS="--linux"
        ;;
    all)
        PLATFORM_FLAGS="--win --mac --linux"
        ;;
    "")
        # Default: current platform (no flags needed)
        ;;
    *)
        echo "Unknown platform: $PLATFORM"
        exit 1
        ;;
esac

npx electron-builder $PLATFORM_FLAGS

echo ""
echo "========================================"
echo "  Build Complete!"
echo "========================================"
echo ""
echo "Flavor: ${FLAVOR^^}"
echo "Output files are in: release/"
ls -la release/ 2>/dev/null || echo "  (release folder not found)"
echo ""

# Rename output files to include flavor if GPU
if [ "$FLAVOR" = "gpu" ]; then
    echo "Renaming output files to include GPU flavor..."
    cd release
    for f in *; do
        if [[ -f "$f" && ! "$f" =~ "-gpu" ]]; then
            # Insert -gpu before the extension or version
            newname=$(echo "$f" | sed 's/\(nirs4all-[0-9.]*\)/\1-gpu/')
            if [ "$newname" != "$f" ]; then
                mv "$f" "$newname"
                echo "  $f -> $newname"
            fi
        fi
    done
    cd ..
fi
