#!/bin/bash
# Build the Python backend using PyInstaller
#
# Usage:
#   ./scripts/build-backend.sh [options]
#
# Options:
#   --flavor cpu|gpu   Build flavor (default: cpu)
#   --clean            Remove previous build artifacts before building
#
# Examples:
#   ./scripts/build-backend.sh                    # CPU build
#   ./scripts/build-backend.sh --flavor gpu       # GPU build
#   ./scripts/build-backend.sh --clean --flavor cpu

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Default values
FLAVOR="cpu"
CLEAN=false

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
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--flavor cpu|gpu] [--clean]"
            exit 1
            ;;
    esac
done

# Validate flavor
if [[ "$FLAVOR" != "cpu" && "$FLAVOR" != "gpu" && "$FLAVOR" != "gpu-metal" ]]; then
    echo "Error: Invalid flavor '$FLAVOR'. Must be 'cpu', 'gpu' (CUDA), or 'gpu-metal' (macOS)."
    exit 1
fi

# Auto-detect: on macOS, 'gpu' should use 'gpu-metal'
if [[ "$OSTYPE" == "darwin"* && "$FLAVOR" == "gpu" ]]; then
    echo "Note: macOS detected, using 'gpu-metal' (Metal) instead of 'gpu' (CUDA)"
    FLAVOR="gpu-metal"
fi

echo "=== Building nirs4all backend (${FLAVOR^^} flavor) ==="

# Clean previous builds if requested
if [ "$CLEAN" = true ]; then
    echo "Cleaning previous builds..."
    rm -rf dist/nirs4all-backend dist/nirs4all-backend.exe
    rm -rf build/nirs4all-backend
    rm -rf backend-dist
fi

# Ensure virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Error: Virtual environment not found at .venv"
    echo "Please create it first:"
    echo "  python -m venv .venv"
    echo "  source .venv/bin/activate"
    echo "  pip install -r requirements-${FLAVOR}.txt"
    exit 1
fi

# Activate virtual environment
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    source .venv/Scripts/activate
else
    source .venv/bin/activate
fi

# Ensure PyInstaller is installed
if ! command -v pyinstaller &> /dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller>=6.12.0
fi

# Install flavor-specific dependencies if needed
if [[ "$FLAVOR" == "gpu-metal" ]]; then
    REQUIREMENTS_FILE="requirements-gpu-macos.txt"
else
    REQUIREMENTS_FILE="requirements-${FLAVOR}.txt"
fi

if [ -f "$REQUIREMENTS_FILE" ]; then
    echo "Installing ${FLAVOR} dependencies from ${REQUIREMENTS_FILE}..."
    pip install -q -r "$REQUIREMENTS_FILE"
else
    echo "Warning: ${REQUIREMENTS_FILE} not found, using default requirements.txt"
    pip install -q -r requirements.txt
fi

# Build the backend with flavor
echo "Running PyInstaller (${FLAVOR} flavor)..."
NIRS4ALL_BUILD_FLAVOR="$FLAVOR" pyinstaller backend.spec --noconfirm

# Create backend-dist directory
mkdir -p backend-dist

# Copy the built executable to backend-dist
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    BACKEND_EXE="dist/nirs4all-backend.exe"
else
    BACKEND_EXE="dist/nirs4all-backend"
fi

if [ -f "$BACKEND_EXE" ]; then
    cp "$BACKEND_EXE" backend-dist/
    echo "Backend built successfully: backend-dist/$(basename $BACKEND_EXE)"
else
    echo "Error: Backend executable not found at $BACKEND_EXE"
    exit 1
fi

# Make executable on Unix
if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
    chmod +x backend-dist/nirs4all-backend
fi

# Show build info
echo ""
echo "=== Backend build complete (${FLAVOR^^}) ==="
echo "Output: backend-dist/$(basename $BACKEND_EXE)"
echo "Size: $(du -h backend-dist/$(basename $BACKEND_EXE) | cut -f1)"
