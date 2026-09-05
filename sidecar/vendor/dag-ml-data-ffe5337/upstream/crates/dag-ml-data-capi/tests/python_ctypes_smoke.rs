use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn workspace_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf()
}

fn build_capi_cdylib(workspace_root: &Path) -> PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let build = Command::new(cargo)
        .arg("build")
        .arg("-p")
        .arg("dag-ml-data-capi")
        .arg("--lib")
        .current_dir(workspace_root)
        .output()
        .expect("run cargo build for cdylib");
    assert!(
        build.status.success(),
        "cargo build failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr)
    );

    let target_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(|path| {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                path
            } else {
                workspace_root.join(path)
            }
        })
        .unwrap_or_else(|| workspace_root.join("target"));
    target_dir.join("debug").join(format!(
        "{}dag_ml_data_capi{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    ))
}

#[test]
fn python_ctypes_exercises_inmemory_provider_vtable() {
    let workspace_root = workspace_root();
    let lib_path = build_capi_cdylib(&workspace_root);
    let envelope_path = workspace_root
        .join("examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json");
    let request_path = workspace_root
        .join("examples/fixtures/oof_campaign/materialization_request_model_base_x.json");

    let script = r#"
import ctypes
import json
import sys


class DagMlDataString(ctypes.Structure):
    _fields_ = [("ptr", ctypes.c_void_p), ("len", ctypes.c_size_t)]


class DagMlDataBytesView(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(ctypes.c_uint8)), ("len", ctypes.c_size_t)]


class ArrowArray(ctypes.Structure):
    pass


class ArrowSchema(ctypes.Structure):
    pass


ArrowArray._fields_ = [
    ("length", ctypes.c_int64),
    ("null_count", ctypes.c_int64),
    ("offset", ctypes.c_int64),
    ("n_buffers", ctypes.c_int64),
    ("n_children", ctypes.c_int64),
    ("buffers", ctypes.POINTER(ctypes.c_void_p)),
    ("children", ctypes.POINTER(ctypes.POINTER(ArrowArray))),
    ("dictionary", ctypes.POINTER(ArrowArray)),
    ("release", ctypes.c_void_p),
    ("private_data", ctypes.c_void_p),
]

ArrowSchema._fields_ = [
    ("format", ctypes.c_char_p),
    ("name", ctypes.c_char_p),
    ("metadata", ctypes.c_char_p),
    ("flags", ctypes.c_int64),
    ("n_children", ctypes.c_int64),
    ("children", ctypes.POINTER(ctypes.POINTER(ArrowSchema))),
    ("dictionary", ctypes.POINTER(ArrowSchema)),
    ("release", ctypes.c_void_p),
    ("private_data", ctypes.c_void_p),
]


MATERIALIZE = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.c_uint64),
)
MAKE_VIEW = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.c_uint64),
)
VIEW_IDENTITY = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
TARGET_ARROW = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
FEATURE_ARROW = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
RELEASE = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint64)
DESTROY = ctypes.CFUNCTYPE(None, ctypes.c_void_p)


class DagMlDataVTable(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("user_data", ctypes.c_void_p),
        ("materialize", MATERIALIZE),
        ("make_view", MAKE_VIEW),
        ("view_identity", VIEW_IDENTITY),
        ("target_arrow", TARGET_ARROW),
        ("feature_arrow", FEATURE_ARROW),
        ("release", RELEASE),
        ("destroy", DESTROY),
    ]


def as_u8_buffer(data: bytes):
    buffer = ctypes.create_string_buffer(data)
    return buffer, ctypes.cast(buffer, ctypes.POINTER(ctypes.c_uint8))


def bytes_view(data: bytes):
    buffer, ptr = as_u8_buffer(data)
    return buffer, DagMlDataBytesView(ptr, len(data))


def valid(bitmap, idx):
    if not bitmap:
        return True
    byte = ctypes.cast(bitmap, ctypes.POINTER(ctypes.c_uint8))[idx // 8]
    return (byte & (1 << (idx % 8))) != 0


def utf8_values(array_ptr):
    array = array_ptr.contents
    offsets = ctypes.cast(array.buffers[1], ctypes.POINTER(ctypes.c_int32))
    value_ptr = ctypes.cast(array.buffers[2], ctypes.POINTER(ctypes.c_uint8))
    out = []
    for idx in range(array.length):
        if not valid(array.buffers[0], idx):
            out.append(None)
            continue
        start = offsets[idx]
        end = offsets[idx + 1]
        out.append(bytes(value_ptr[start:end]).decode("utf-8"))
    return out


def f64_values(array_ptr):
    array = array_ptr.contents
    values = ctypes.cast(array.buffers[1], ctypes.POINTER(ctypes.c_double))
    return [values[idx] if valid(array.buffers[0], idx) else None for idx in range(array.length)]


lib = ctypes.CDLL(sys.argv[1])
lib.dagmldata_inmemory_provider_new_json.argtypes = [
    ctypes.POINTER(ctypes.c_uint8),
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_uint8),
    ctypes.c_size_t,
    ctypes.POINTER(DagMlDataVTable),
    ctypes.POINTER(DagMlDataString),
]
lib.dagmldata_inmemory_provider_new_json.restype = ctypes.c_int
lib.dagmldata_inmemory_provider_destroy.argtypes = [ctypes.POINTER(DagMlDataVTable)]
lib.dagmldata_inmemory_provider_destroy.restype = None
lib.dagmldata_arrow_array_free.argtypes = [ctypes.POINTER(ArrowArray)]
lib.dagmldata_arrow_array_free.restype = None
lib.dagmldata_arrow_schema_free.argtypes = [ctypes.POINTER(ArrowSchema)]
lib.dagmldata_arrow_schema_free.restype = None

envelope = open(sys.argv[2], "rb").read()
request = open(sys.argv[3], "rb").read()
target_tables = json.dumps([
    {
        "target_id": "y",
        "values": [
            {"sample_id": "S001", "value": 42.0},
            {"sample_id": "S002", "value": 7.0},
        ],
    }
]).encode("utf-8")
view = json.dumps({"sample_ids": ["S001"], "include_augmented": False}).encode("utf-8")

env_buf, env_ptr = as_u8_buffer(envelope)
target_buf, target_ptr = as_u8_buffer(target_tables)
vtable = DagMlDataVTable()
error = DagMlDataString()
status = lib.dagmldata_inmemory_provider_new_json(
    env_ptr, len(envelope), target_ptr, len(target_tables), ctypes.byref(vtable), ctypes.byref(error)
)
assert status == 0, status
assert vtable.user_data
assert not error.ptr

req_buf, req_view = bytes_view(request)
data_handle = ctypes.c_uint64()
status = vtable.materialize(vtable.user_data, 0, req_view, ctypes.byref(data_handle))
assert status == 0, status
assert data_handle.value == 1

view_buf, view_bytes = bytes_view(view)
view_handle = ctypes.c_uint64()
status = vtable.make_view(vtable.user_data, data_handle.value, view_bytes, ctypes.byref(view_handle))
assert status == 0, status
assert view_handle.value == 2

identity_array = ctypes.POINTER(ArrowArray)()
identity_schema = ctypes.POINTER(ArrowSchema)()
status = vtable.view_identity(vtable.user_data, view_handle.value, ctypes.byref(identity_array), ctypes.byref(identity_schema))
assert status == 0, status
assert identity_array.contents.length == 2
assert utf8_values(identity_array.contents.children[0]) == ["obs.S001.base", "obs.S001.rep1"]
lib.dagmldata_arrow_array_free(identity_array)
lib.dagmldata_arrow_schema_free(identity_schema)

target_buf, target_view = bytes_view(b"y")
target_array = ctypes.POINTER(ArrowArray)()
target_schema = ctypes.POINTER(ArrowSchema)()
status = vtable.target_arrow(vtable.user_data, view_handle.value, target_view, ctypes.byref(target_array), ctypes.byref(target_schema))
assert status == 0, status
assert target_array.contents.length == 1
assert utf8_values(target_array.contents.children[0]) == ["S001"]
assert f64_values(target_array.contents.children[2]) == [42.0]
lib.dagmldata_arrow_array_free(target_array)
lib.dagmldata_arrow_schema_free(target_schema)

vtable.release(vtable.user_data, view_handle.value)
released_array = ctypes.POINTER(ArrowArray)()
released_schema = ctypes.POINTER(ArrowSchema)()
status = vtable.view_identity(vtable.user_data, view_handle.value, ctypes.byref(released_array), ctypes.byref(released_schema))
assert status == 2, status
assert not bool(released_array)
assert not bool(released_schema)

vtable.release(vtable.user_data, data_handle.value)
lib.dagmldata_inmemory_provider_destroy(ctypes.byref(vtable))
assert not vtable.user_data
"#;
    let path = std::env::temp_dir().join(format!(
        "dag_ml_data_python_ctypes_smoke_{}.py",
        std::process::id()
    ));
    fs::write(&path, script).expect("write Python ctypes smoke");

    let output = Command::new("python3")
        .arg(&path)
        .arg(&lib_path)
        .arg(&envelope_path)
        .arg(&request_path)
        .output()
        .expect("run Python ctypes smoke");
    let _ = fs::remove_file(&path);

    assert!(
        output.status.success(),
        "Python ctypes smoke failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn python_example_provider_smoke_runs_against_c_abi() {
    let workspace_root = workspace_root();
    let lib_path = build_capi_cdylib(&workspace_root);
    let envelope_path = workspace_root
        .join("examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json");
    let request_path = workspace_root
        .join("examples/fixtures/oof_campaign/materialization_request_model_base_x.json");
    let script_path = workspace_root.join("examples/python/provider_smoke.py");

    // The wrapper now lives only in the installable package. A stale copy beside
    // the smoke script would shadow it (Python puts the script dir before
    // PYTHONPATH), silently testing the wrong code.
    assert!(
        !workspace_root
            .join("examples/python/dag_ml_data_provider.py")
            .exists(),
        "stale examples/python/dag_ml_data_provider.py would shadow the installable package"
    );

    // Make the installable `dag_ml_data_provider` package importable and exercise
    // the cdylib discovery path via DAG_ML_DATA_CAPI_LIB, preserving any existing
    // PYTHONPATH. `--lib` is intentionally omitted.
    let package_root = workspace_root.join("crates/dag-ml-data-capi/bindings/python");
    let mut python_paths = vec![package_root];
    if let Some(existing) = std::env::var_os("PYTHONPATH") {
        python_paths.extend(std::env::split_paths(&existing));
    }
    let python_path = std::env::join_paths(python_paths).expect("join PYTHONPATH");

    let output = Command::new("python3")
        .arg(&script_path)
        .arg("--envelope")
        .arg(&envelope_path)
        .arg("--request")
        .arg(&request_path)
        .env("PYTHONPATH", &python_path)
        .env("DAG_ML_DATA_CAPI_LIB", &lib_path)
        .output()
        .expect("run reusable Python provider smoke");

    assert!(
        output.status.success(),
        "Python example provider smoke failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains(r#""identity_rows": 3"#), "{stdout}");
    assert!(stdout.contains(r#""target_rows": 2"#), "{stdout}");
    assert!(stdout.contains(r#""feature_rows": 3"#), "{stdout}");
    assert!(
        stdout.contains(r#""observations": ["obs.S002.base", "obs.S001.base", "obs.S001.rep1"]"#),
        "{stdout}"
    );
}
