#!/usr/bin/env python3
"""
Build script for nirs4all-webapp.

Usage:
    python scripts/build.py [--version VERSION] [--skip-frontend] [--skip-tests]

This script:
1. Updates version.json with version, commit hash, and build date
2. Builds the frontend (npm run build)
3. Runs PyInstaller to create the executable
4. Creates platform-specific archives
5. Generates SHA256 checksums
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from datetime import UTC, datetime, timezone
from pathlib import Path


def get_project_dir() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.resolve()


def get_git_commit() -> str:
    """Get current git commit hash (short)."""
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            capture_output=True,
            text=True,
            check=True,
            cwd=get_project_dir(),
        )
        return result.stdout.strip()
    except Exception:
        return 'unknown'


def get_git_tag() -> str | None:
    """Get current git tag if HEAD is tagged."""
    try:
        result = subprocess.run(
            ['git', 'describe', '--tags', '--exact-match', 'HEAD'],
            capture_output=True,
            text=True,
            check=True,
            cwd=get_project_dir(),
        )
        return result.stdout.strip()
    except Exception:
        return None


def update_version_json(version: str) -> dict:
    """Update version.json with build information."""
    project_dir = get_project_dir()
    version_file = project_dir / 'version.json'

    data = {
        'version': version,
        'build_date': datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'commit': get_git_commit(),
    }

    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    print("Updated version.json:")
    print(f"  version: {data['version']}")
    print(f"  build_date: {data['build_date']}")
    print(f"  commit: {data['commit']}")

    return data


def check_node_installed() -> bool:
    """Check if Node.js is installed."""
    try:
        result = subprocess.run(
            ['node', '--version'],
            capture_output=True,
            text=True,
            check=True,
        )
        print(f"Node.js version: {result.stdout.strip()}")
        return True
    except Exception:
        return False


def check_npm_installed() -> bool:
    """Check if npm is installed."""
    try:
        result = subprocess.run(
            ['npm', '--version'],
            capture_output=True,
            text=True,
            check=True,
        )
        print(f"npm version: {result.stdout.strip()}")
        return True
    except Exception:
        return False


def build_frontend() -> None:
    """Build the React frontend."""
    project_dir = get_project_dir()

    print("\n" + "=" * 60)
    print("Building frontend")
    print("=" * 60)

    # Check if node_modules exists
    if not (project_dir / 'node_modules').exists():
        print("Installing npm dependencies...")
        subprocess.run(
            ['npm', 'ci'],
            cwd=project_dir,
            check=True,
        )

    # Build frontend
    print("Running npm build...")
    subprocess.run(
        ['npm', 'run', 'build'],
        cwd=project_dir,
        check=True,
    )

    # Verify build output
    dist_dir = project_dir / 'dist'
    if not dist_dir.exists():
        raise RuntimeError("Frontend build failed: dist/ directory not found")

    index_html = dist_dir / 'index.html'
    if not index_html.exists():
        raise RuntimeError("Frontend build failed: dist/index.html not found")

    print("Frontend build complete")


def run_pyinstaller() -> None:
    """Run PyInstaller to create the executable."""
    project_dir = get_project_dir()
    spec_file = project_dir / 'nirs4all-webapp.spec'

    print("\n" + "=" * 60)
    print("Running PyInstaller")
    print("=" * 60)

    if not spec_file.exists():
        raise RuntimeError(f"Spec file not found: {spec_file}")

    # Clean previous build
    build_dir = project_dir / 'build'
    dist_pyinstaller = project_dir / 'dist' / 'nirs4all-webapp'
    if build_dir.exists():
        print(f"Cleaning {build_dir}")
        shutil.rmtree(build_dir)

    # Run PyInstaller
    subprocess.run(
        [sys.executable, '-m', 'PyInstaller', str(spec_file), '--clean', '--noconfirm'],
        cwd=project_dir,
        check=True,
    )

    # Verify output
    if not dist_pyinstaller.exists():
        raise RuntimeError("PyInstaller build failed: output directory not found")

    print("PyInstaller build complete")


def get_platform_info() -> tuple[str, str]:
    """Get platform and architecture for asset naming."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    # Normalize platform names
    if system == 'darwin':
        system = 'macos'

    # Normalize architecture
    if machine in ('x86_64', 'amd64'):
        arch = 'x64'
    elif machine in ('aarch64', 'arm64'):
        arch = 'arm64'
    elif machine in ('i386', 'i686'):
        arch = 'x86'
    else:
        arch = machine

    return system, arch


def create_archive(version: str) -> Path:
    """Create platform-specific archive."""
    project_dir = get_project_dir()
    system, arch = get_platform_info()

    print("\n" + "=" * 60)
    print(f"Creating archive for {system}-{arch}")
    print("=" * 60)

    # Source directory (PyInstaller output)
    dist_dir = project_dir / 'dist' / 'nirs4all-webapp'
    if not dist_dir.exists():
        raise RuntimeError(f"Distribution directory not found: {dist_dir}")

    # Output directory
    release_dir = project_dir / 'release'
    release_dir.mkdir(exist_ok=True)

    # Archive name following the convention expected by updater
    # Format: nirs4all-webapp-{version}-{platform}-{arch}.{ext}
    if system == 'windows':
        archive_name = f'nirs4all-webapp-{version}-windows-{arch}'
        archive_path = release_dir / f'{archive_name}.zip'
        print(f"Creating ZIP archive: {archive_path.name}")
        shutil.make_archive(
            str(archive_path.with_suffix('')),
            'zip',
            root_dir=dist_dir.parent,
            base_dir=dist_dir.name,
        )
    else:
        # Linux and macOS use tar.gz
        archive_name = f'nirs4all-webapp-{version}-{system}-{arch}'
        archive_path = release_dir / f'{archive_name}.tar.gz'
        print(f"Creating tarball: {archive_path.name}")
        shutil.make_archive(
            str(release_dir / archive_name),
            'gztar',
            root_dir=dist_dir.parent,
            base_dir=dist_dir.name,
        )

    # Verify archive was created
    if not archive_path.exists():
        raise RuntimeError(f"Failed to create archive: {archive_path}")

    archive_size = archive_path.stat().st_size
    print(f"Archive created: {archive_path}")
    print(f"Size: {archive_size / 1024 / 1024:.1f} MB")

    return archive_path


def generate_checksum(archive_path: Path) -> tuple[str, Path]:
    """Generate SHA256 checksum file for the archive."""
    print("\n" + "=" * 60)
    print("Generating SHA256 checksum")
    print("=" * 60)

    sha256_hash = hashlib.sha256()
    with open(archive_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256_hash.update(chunk)

    checksum = sha256_hash.hexdigest()
    checksum_file = archive_path.with_suffix(archive_path.suffix + '.sha256')

    # Write checksum file in standard format: "<hash>  <filename>"
    with open(checksum_file, 'w', encoding='utf-8') as f:
        f.write(f'{checksum}  {archive_path.name}\n')

    print(f"SHA256: {checksum}")
    print(f"Checksum file: {checksum_file}")

    return checksum, checksum_file


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Build nirs4all-webapp desktop application',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/build.py --version 0.1.0
  python scripts/build.py --version 0.1.0 --skip-frontend
  python scripts/build.py  # Uses version from git tag or default
        """,
    )
    parser.add_argument(
        '--version',
        default=None,
        help='Version string (default: from git tag or "dev")',
    )
    parser.add_argument(
        '--skip-frontend',
        action='store_true',
        help='Skip frontend build (use existing dist/)',
    )
    parser.add_argument(
        '--skip-archive',
        action='store_true',
        help='Skip archive creation',
    )
    args = parser.parse_args()

    # Determine version
    version = args.version
    if version is None:
        # Try to get from git tag
        tag = get_git_tag()
        if tag:
            version = tag.lstrip('v')
        else:
            version = 'dev'

    system, arch = get_platform_info()

    print("=" * 60)
    print("nirs4all-webapp Build")
    print("=" * 60)
    print(f"Version: {version}")
    print(f"Platform: {system}")
    print(f"Architecture: {arch}")
    print(f"Python: {sys.version}")
    print("=" * 60)

    try:
        # Step 1: Update version.json
        update_version_json(version)

        # Step 2: Build frontend
        if not args.skip_frontend:
            if not check_node_installed() or not check_npm_installed():
                print("ERROR: Node.js and npm are required to build the frontend")
                print("Install Node.js from https://nodejs.org/")
                return 1
            build_frontend()
        else:
            print("\nSkipping frontend build (--skip-frontend)")
            # Verify frontend exists
            dist_dir = get_project_dir() / 'dist'
            if not dist_dir.exists() or not (dist_dir / 'index.html').exists():
                print("ERROR: Frontend not built. Run without --skip-frontend first.")
                return 1

        # Step 3: Run PyInstaller
        run_pyinstaller()

        # Step 4: Create archive
        if not args.skip_archive:
            archive_path = create_archive(version)

            # Step 5: Generate checksum
            checksum, checksum_file = generate_checksum(archive_path)

            print("\n" + "=" * 60)
            print("Build complete!")
            print("=" * 60)
            print(f"Archive: {archive_path}")
            print(f"Checksum: {checksum_file}")
        else:
            print("\nSkipping archive creation (--skip-archive)")
            print("\n" + "=" * 60)
            print("Build complete!")
            print("=" * 60)
            print(f"Output: {get_project_dir() / 'dist' / 'nirs4all-webapp'}")

        return 0

    except subprocess.CalledProcessError as e:
        print(f"\nERROR: Command failed with exit code {e.returncode}")
        return e.returncode
    except Exception as e:
        print(f"\nERROR: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
