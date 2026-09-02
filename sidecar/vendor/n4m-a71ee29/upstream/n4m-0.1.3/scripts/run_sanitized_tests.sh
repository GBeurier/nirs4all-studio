#!/usr/bin/env bash
# Build and run the Rust test harness with the same clang sanitizer runtime as
# the prebuilt libn4m sanitizer preset. This is intentionally Linux-only: the
# native ci-{asan,ubsan,asan_ubsan} presets are Linux clang-16 configurations.
set -euo pipefail

sanitizer=${1:?usage: run_sanitized_tests.sh <asan|ubsan|asan_ubsan>}
case "$sanitizer" in
  asan)
    clang_sanitizers=address
    runtime_components=(asan)
    ;;
  ubsan)
    clang_sanitizers=undefined
    runtime_components=(ubsan_standalone)
    ;;
  asan_ubsan)
    clang_sanitizers=address,undefined
    # Clang's shared ASan runtime includes the UBSan handlers for a combined
    # address+undefined build, so this is the runtime the linker emits.
    runtime_components=(asan)
    ;;
  *)
    echo "unsupported sanitizer preset: $sanitizer" >&2
    exit 2
    ;;
esac

clang=${N4M_CLANG:-clang-16}
if ! command -v "$clang" >/dev/null 2>&1; then
  echo "${clang} is required for Rust sanitizer tests; install clang-16 and libclang-rt-16-dev" >&2
  exit 2
fi
runtime_dir=$("$clang" --print-runtime-dir)
if [[ ! -d "$runtime_dir" ]]; then
  echo "${clang} did not report a usable sanitizer runtime directory: $runtime_dir" >&2
  exit 2
fi
for component in "${runtime_components[@]}"; do
  if ! compgen -G "$runtime_dir/libclang_rt.${component}-*.so" >/dev/null; then
    echo "missing clang sanitizer runtime libclang_rt.${component}-*.so in $runtime_dir" >&2
    exit 2
  fi
done

: "${N4M_LIB_DIR:?N4M_LIB_DIR must point at the matching sanitized libn4m directory}"
if [[ ! -f "$N4M_LIB_DIR/libn4m.so" ]]; then
  echo "N4M_LIB_DIR does not contain libn4m.so: $N4M_LIB_DIR" >&2
  exit 2
fi

export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-"target/rust-${sanitizer}"}
export LD_LIBRARY_PATH="$runtime_dir:$N4M_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export RUSTFLAGS="${RUSTFLAGS:-} -C linker=$clang -C link-arg=-fsanitize=$clang_sanitizers -C link-arg=-shared-libsan"

# Build the exact Rust test harness first, then prove that it dynamically
# resolves clang's selected runtime before executing it. This prevents a green
# Cargo test that only happened to load a system GCC sanitizer runtime.
cargo test --locked --workspace --no-run
mapfile -t test_binaries < <(find "$CARGO_TARGET_DIR/debug/deps" -maxdepth 1 -type f -perm -111 -name 'n4m-*' -print)
if (( ${#test_binaries[@]} != 1 )); then
  echo "expected exactly one Rust n4m test executable, found ${#test_binaries[@]}" >&2
  printf '%s\n' "${test_binaries[@]}" >&2
  exit 1
fi
runtime_deps=$(ldd "${test_binaries[0]}")
for component in "${runtime_components[@]}"; do
  if ! grep -F "libclang_rt.${component}" <<<"$runtime_deps" >/dev/null; then
    echo "Rust test executable is missing clang ${component} runtime:" >&2
    echo "$runtime_deps" >&2
    exit 1
  fi
done

cargo test --locked --workspace
