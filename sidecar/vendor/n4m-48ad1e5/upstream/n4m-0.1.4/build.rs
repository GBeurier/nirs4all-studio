use std::{
    env, fs,
    path::{Path, PathBuf},
};

const ABI_MAJOR: &str = "2";
const ABI_MINOR: &str = "5";
const ABI_PATCH: &str = "0";
const MATRIX_VIEW_SIZE: &str = "48";
const MATRIX_VIEW_ALIGN: &str = "8";
const OPTIMIZER_OPTIONS_SIZE: &str = "120";

fn main() {
    println!("cargo:rerun-if-env-changed=N4M_LIB_DIR");
    println!("cargo:rerun-if-env-changed=N4M_RUNTIME_RPATH");
    println!("cargo:rerun-if-env-changed=N4M_INCLUDE_DIR");
    println!("cargo:rerun-if-env-changed=N4M_GENERATED_INCLUDE_DIR");

    let pointer_width = env::var("CARGO_CFG_TARGET_POINTER_WIDTH")
        .expect("Cargo did not set CARGO_CFG_TARGET_POINTER_WIDTH");
    if pointer_width != "64" {
        panic!(
            "n4m Rust binding supports only 64-bit targets; C ABI n4m_matrix_view_t is not supported on {pointer_width}-bit targets"
        );
    }

    // The dynamic feature deliberately does not require a build-tree library
    // or generated headers.  It validates the ABI only after opening the
    // explicitly selected runtime at execution time.
    if env::var_os("CARGO_FEATURE_LINKED").is_none()
        || env::var_os("CARGO_FEATURE_DYNAMIC").is_some()
    {
        return;
    }

    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("Cargo did not set CARGO_CFG_TARGET_OS");
    let lib_dir = required_dir("N4M_LIB_DIR");
    validate_library_dir(&lib_dir, &target_os);
    let include_dirs = include_dirs(&lib_dir);
    compile_header_probe(&include_dirs);

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    // The Rust link directive below is `-ln4m`, so accept only the matching
    // development link-name artifact. A versioned ELF SONAME alone (for
    // example libn4m.so.2) is loadable at runtime but cannot satisfy this link.
    println!("cargo:rustc-link-lib=dylib=n4m");
    if let Some(rpath) = env::var_os("N4M_RUNTIME_RPATH") {
        let rpath = canonical_dir(PathBuf::from(rpath), "N4M_RUNTIME_RPATH");
        match target_os.as_str() {
            "linux" | "macos" => {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{}", rpath.display());
            }
            "windows" => println!(
                "cargo:warning=N4M_RUNTIME_RPATH is ignored on Windows; make n4m.dll discoverable through PATH or beside the executable"
            ),
            _ => println!(
                "cargo:warning=N4M_RUNTIME_RPATH is not configured for target OS {target_os}; use that platform's dynamic-loader policy"
            ),
        }
    }
}

fn required_dir(name: &str) -> PathBuf {
    let value = env::var_os(name).unwrap_or_else(|| {
        panic!("{name} is required; point it at the directory containing the target libn4m shared library")
    });
    canonical_dir(PathBuf::from(value), name)
}

fn canonical_dir(path: PathBuf, label: &str) -> PathBuf {
    let path = fs::canonicalize(&path)
        .unwrap_or_else(|error| panic!("{label} cannot be resolved ({}): {error}", path.display()));
    if !path.is_dir() {
        panic!("{label} must name a directory, got {}", path.display());
    }
    path
}

fn validate_library_dir(dir: &Path, target_os: &str) {
    let candidates: &[&str] = match target_os {
        // The Windows workflow exercises the MSVC preset, whose import
        // library is n4m.lib. Do not accept MinGW's libn4m.dll.a here: it is
        // not compatible with the MSVC linker used for this target.
        "windows" => &["n4m.lib"],
        "macos" => &["libn4m.dylib"],
        _ => &["libn4m.so"],
    };
    if !candidates.iter().any(|name| dir.join(name).is_file()) {
        panic!(
            "N4M_LIB_DIR={} has no target libn4m artifact; expected one of {} for {target_os}",
            dir.display(),
            candidates.join(", ")
        );
    }
}

fn include_dirs(lib_dir: &Path) -> Vec<PathBuf> {
    let manifest = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("Cargo did not set CARGO_MANIFEST_DIR"),
    );
    let repository_root = manifest
        .ancestors()
        .nth(3)
        .expect("n4m crate must remain under bindings/rust/n4m");
    let public = env::var_os("N4M_INCLUDE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repository_root.join("cpp/include"));
    let mut dirs = vec![canonical_dir(public, "N4M_INCLUDE_DIR")];
    if let Some(generated) = env::var_os("N4M_GENERATED_INCLUDE_DIR") {
        dirs.push(canonical_dir(
            PathBuf::from(generated),
            "N4M_GENERATED_INCLUDE_DIR",
        ));
    } else {
        // CMake generates n4m_export.h at <build-preset>/generated/n4m. An
        // installed include directory already contains this header, so only add
        // the development-tree candidate when it exists.
        let candidate = lib_dir
            .parent()
            .and_then(Path::parent)
            .map(|preset_root| preset_root.join("generated"));
        if let Some(candidate) = candidate.filter(|path| path.is_dir()) {
            dirs.push(canonical_dir(
                candidate,
                "CMake generated include directory",
            ));
        }
    }
    for header in ["n4m/n4m.h", "n4m/n4m_version.h", "n4m/optimization.h"] {
        if !dirs.iter().any(|dir| dir.join(header).is_file()) {
            panic!("n4m public header {header} is not available in N4M_INCLUDE_DIR/N4M_GENERATED_INCLUDE_DIR");
        }
    }
    if !dirs
        .iter()
        .any(|dir| dir.join("n4m/n4m_export.h").is_file())
    {
        panic!("generated n4m/n4m_export.h is not available; set N4M_GENERATED_INCLUDE_DIR");
    }
    dirs
}

fn compile_header_probe(include_dirs: &[PathBuf]) {
    let manifest = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("Cargo did not set CARGO_MANIFEST_DIR"),
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("abi_probe.c").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("src/lib.rs").display()
    );
    verify_probe_covers_rust_externs(&manifest);
    for dir in include_dirs {
        for header in [
            "n4m/n4m.h",
            "n4m/n4m_version.h",
            "n4m/optimization.h",
            "n4m/n4m_export.h",
        ] {
            let path = dir.join(header);
            if path.is_file() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
    let mut probe = cc::Build::new();
    probe.file(manifest.join("abi_probe.c"));
    // abi_probe.c uses C11 facilities (_Generic, _Static_assert, and
    // alignof). MSVC otherwise defaults to an older C dialect, so select C11
    // explicitly instead of relying on the compiler's default mode.
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        probe.flag("/std:c11");
    } else {
        probe.std("c11");
    }
    for dir in include_dirs {
        probe.include(dir);
    }
    probe.define("N4M_RUST_ABI_MAJOR", Some(ABI_MAJOR));
    probe.define("N4M_RUST_ABI_MINOR", Some(ABI_MINOR));
    probe.define("N4M_RUST_ABI_PATCH", Some(ABI_PATCH));
    probe.define("N4M_RUST_MATRIX_VIEW_SIZE", Some(MATRIX_VIEW_SIZE));
    probe.define("N4M_RUST_MATRIX_VIEW_ALIGN", Some(MATRIX_VIEW_ALIGN));
    probe.define(
        "N4M_RUST_OPTIMIZER_OPTIONS_SIZE",
        Some(OPTIMIZER_OPTIONS_SIZE),
    );
    probe.warnings_into_errors(true);
    probe.compile("n4m_rust_abi_probe");
}

/// A signature assertion only protects declarations that actually have one.
/// Refuse to build when a new Rust extern is added without a matching C
/// `_Generic` assertion in abi_probe.c.
fn verify_probe_covers_rust_externs(manifest: &Path) {
    let rust = fs::read_to_string(manifest.join("src/lib.rs"))
        .expect("cannot read Rust FFI declarations for ABI probe coverage");
    let probe = fs::read_to_string(manifest.join("abi_probe.c")).expect("cannot read C ABI probe");
    let mut missing = Vec::new();
    for line in rust.lines() {
        let Some(rest) = line.trim_start().strip_prefix("fn n4m_") else {
            continue;
        };
        let name = format!("n4m_{}", rest.split('(').next().expect("FFI function name"));
        let assertion = format!("N4M_RUST_SIGNATURE_IS({name},");
        if !probe.contains(&assertion) {
            missing.push(name);
        }
    }
    if !missing.is_empty() {
        panic!(
            "abi_probe.c lacks signature assertions for Rust extern declarations: {}",
            missing.join(", ")
        );
    }
}
