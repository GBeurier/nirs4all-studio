#!/usr/bin/env bash
set -euo pipefail

apply_wslconf=false

for arg in "$@"; do
  case "$arg" in
    --apply-wslconf) apply_wslconf=true ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/setup-wsl.sh [--apply-wslconf]

Sets up a WSL-friendly Node.js environment to avoid using Windows node/npm from inside WSL.

Options:
  --apply-wslconf   Writes /etc/wsl.conf to disable Windows PATH injection (requires sudo).
EOF
      exit 0
      ;;
  esac
done

is_wsl=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  is_wsl=true
fi

if [[ "$is_wsl" != "true" ]]; then
  echo "Not running inside WSL; nothing to do."
  exit 0
fi

warned=false
if echo ":$PATH:" | grep -q ":/mnt/c/Program Files/nodejs:"; then
  echo "WARNING: Windows Node.js is on your PATH inside WSL: /mnt/c/Program Files/nodejs"
  echo "This frequently causes npm installs to fail (UNC path / cmd.exe issues)."
  warned=true
fi

if [[ "$apply_wslconf" == "true" ]]; then
  if [[ ! -f /etc/wsl.conf ]] || ! grep -q '^\s*appendWindowsPath\s*=\s*false\s*$' /etc/wsl.conf; then
    echo "Writing /etc/wsl.conf to disable Windows PATH injection (requires sudo)..."
    sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[interop]
appendWindowsPath=false
EOF
    echo "Done. You must restart WSL for this to take effect: run 'wsl.exe --shutdown' from Windows."
  else
    echo "/etc/wsl.conf already configured with appendWindowsPath=false"
  fi
else
  echo "Tip: For a permanent fix, disable Windows PATH injection in WSL:"
  echo "  sudo tee /etc/wsl.conf <<'EOF'"
  echo "  [interop]"
  echo "  appendWindowsPath=false"
  echo "  EOF"
  echo "Then restart WSL: from Windows run 'wsl.exe --shutdown'."
fi

# Ensure nvm is available
export NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "Installing nvm..."
  command -v curl >/dev/null || (sudo apt-get update && sudo apt-get install -y curl)
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"

# Use .nvmrc if present; otherwise install latest LTS
node_version=""
if [[ -f .nvmrc ]]; then
  node_version="$(tr -d ' \t\r\n' < .nvmrc)"
fi

if [[ -n "$node_version" ]]; then
  echo "Installing/using Node via nvm from .nvmrc: $node_version"
  nvm install "$node_version" >/dev/null
  nvm use "$node_version" >/dev/null
else
  echo "Installing/using Node LTS via nvm"
  nvm install --lts >/dev/null
  nvm use --lts >/dev/null
fi

echo "node: $(command -v node) ($(node -v))"
echo "npm:  $(command -v npm) ($(npm -v))"

if [[ "$warned" == "true" ]]; then
  echo "If you still see Windows npm in 'which npm', open a new WSL shell after applying /etc/wsl.conf."
fi
