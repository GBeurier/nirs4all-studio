#!/usr/bin/env bash
# Run CI tests locally in Docker — replicates GitHub Actions environment
#
# Usage:
#   ./scripts/ci-test.sh              # Run all checks
#   ./scripts/ci-test.sh frontend     # Frontend only (vitest + build)
#   ./scripts/ci-test.sh backend      # Backend only (pytest)
#   ./scripts/ci-test.sh e2e          # Playwright E2E only
#   ./scripts/ci-test.sh lint         # Linting only
#   ./scripts/ci-test.sh shell        # Drop into the container shell
#   ./scripts/ci-test.sh --rebuild    # Force rebuild the image

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="nirs4all-webapp-ci"
TARGET="${1:-all}"

# Force rebuild if requested
if [ "$TARGET" = "--rebuild" ]; then
    echo "Force rebuilding CI image..."
    docker build -f Dockerfile.ci -t "$IMAGE_NAME" --no-cache .
    echo "Done. Run again without --rebuild to execute tests."
    exit 0
fi

# Always build — Docker layer caching skips unchanged layers automatically.
# This ensures source file changes (tests, config, etc.) are always picked up.
echo "Building CI image (cached layers reused when unchanged)..."
docker build -f Dockerfile.ci -t "$IMAGE_NAME" .

# Run
DOCKER_ARGS=(
    --rm
    -e CI=true
)

# Interactive mode for shell
if [ "$TARGET" = "shell" ]; then
    DOCKER_ARGS+=(-it)
fi

echo "Running: $TARGET"
docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" "$TARGET"
