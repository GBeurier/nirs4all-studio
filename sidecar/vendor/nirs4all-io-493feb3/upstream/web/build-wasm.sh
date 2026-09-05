#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO_ROOT="$(cd "$HERE/.." && pwd)"
WORKSPACE_ROOT="$(cd "$IO_ROOT/.." && pwd)"
FORMATS_ROOT="${N4IO_FORMATS_ROOT:-$WORKSPACE_ROOT/nirs4all-formats}"
export PATH="$HOME/.cargo/bin:$PATH"
WASM_PACK="${WASM_PACK:-$(command -v wasm-pack || true)}"
if [[ -z "$WASM_PACK" && -x "$HOME/.cargo/bin/wasm-pack" ]]; then
  WASM_PACK="$HOME/.cargo/bin/wasm-pack"
fi
if [[ -z "$WASM_PACK" ]]; then
  echo "wasm-pack is required" >&2
  exit 1
fi

if [[ ! -f "$FORMATS_ROOT/bindings/wasm/Cargo.toml" ]]; then
  echo "nirs4all-formats checkout not found: $FORMATS_ROOT" >&2
  echo "set N4IO_FORMATS_ROOT to the exact Formats source checkout" >&2
  exit 1
fi

# The committed web bundles are part of the source archive. Canonicalize every
# Rust source root that can otherwise be embedded by panic/debug metadata.
CARGO_ROOT="${CARGO_HOME:-$HOME/.cargo}"
RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$IO_ROOT=/usr/src/nirs4all-io"
RUSTFLAGS+=" --remap-path-prefix=$FORMATS_ROOT=/usr/src/nirs4all-formats"
RUSTFLAGS+=" --remap-path-prefix=$CARGO_ROOT=/usr/src/cargo-home"
export RUSTFLAGS
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$IO_ROOT" log -1 --format=%ct)}"

# zstd-compressed Parquet is decoded inside the Rust/Parquet WASM bundle. The
# upstream zstd C shim can compile to wasm32 with emcc, but cc-rs must not add
# its own `--target=wasm32-unknown-unknown` flag because emcc rejects it.
if [[ -z "${CC_wasm32_unknown_unknown:-}" ]]; then
  EMCC="$(command -v emcc || true)"
  if [[ -z "$EMCC" ]]; then
    for candidate in \
      "${EMSDK:-}/upstream/emscripten/emcc" \
      "$HOME/emsdk/upstream/emscripten/emcc"; do
      if [[ -n "$candidate" && -x "$candidate" ]]; then
        EMCC="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$EMCC" ]]; then
    export CC_wasm32_unknown_unknown="$EMCC"
  fi
fi

if [[ -z "${AR_wasm32_unknown_unknown:-}" ]]; then
  EMAR="$(command -v emar || true)"
  if [[ -z "$EMAR" ]]; then
    for candidate in \
      "${EMSDK:-}/upstream/emscripten/emar" \
      "$HOME/emsdk/upstream/emscripten/emar"; do
      if [[ -n "$candidate" && -x "$candidate" ]]; then
        EMAR="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$EMAR" ]]; then
    export AR_wasm32_unknown_unknown="$EMAR"
  fi
fi

if [[ "${CC_wasm32_unknown_unknown:-}" == *emcc ]]; then
  export CRATE_CC_NO_DEFAULTS="${CRATE_CC_NO_DEFAULTS:-1}"
fi

mkdir -p "$HERE/pkg"
rm -rf "$HERE/pkg/formats" "$HERE/pkg/io"

"$WASM_PACK" build "$FORMATS_ROOT/bindings/wasm" \
  --target web \
  --release \
  --out-dir "$HERE/pkg/formats" \
  --locked

"$WASM_PACK" build "$IO_ROOT/bindings/wasm" \
  --target web \
  --release \
  --out-dir "$HERE/pkg/io" \
  --locked

echo "WASM bundles written to $HERE/pkg"
