use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[test]
fn c_header_exposes_provider_vtable_with_arrow_types() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let source = r#"
#include <stddef.h>
#include <stdint.h>
#include "dag_ml_data.h"

static DagMlDataStatusCode materialize(void *user_data, DagMlDataHandle dataset, DagMlDataBytesView request_json, DagMlDataHandle *out_handle) {
    (void)user_data;
    (void)dataset;
    (void)request_json;
    if (out_handle != NULL) {
        *out_handle = 1;
    }
    return DAG_ML_DATA_STATUS_OK;
}

static DagMlDataStatusCode make_view(void *user_data, DagMlDataHandle data, DagMlDataBytesView selector_json, DagMlDataHandle *out_view) {
    (void)user_data;
    (void)data;
    (void)selector_json;
    if (out_view != NULL) {
        *out_view = 2;
    }
    return DAG_ML_DATA_STATUS_OK;
}

static DagMlDataStatusCode view_identity(void *user_data, DagMlDataHandle view, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema) {
    (void)user_data;
    (void)view;
    if (out_arrow_array != NULL) {
        *out_arrow_array = NULL;
    }
    if (out_arrow_schema != NULL) {
        *out_arrow_schema = NULL;
    }
    return DAG_ML_DATA_STATUS_OK;
}

static DagMlDataStatusCode target_arrow(void *user_data, DagMlDataHandle view, DagMlDataBytesView target_name, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema) {
    (void)user_data;
    (void)view;
    (void)target_name;
    if (out_arrow_array != NULL) {
        *out_arrow_array = NULL;
    }
    if (out_arrow_schema != NULL) {
        *out_arrow_schema = NULL;
    }
    return DAG_ML_DATA_STATUS_OK;
}

static DagMlDataStatusCode feature_arrow(void *user_data, DagMlDataHandle view, DagMlDataBytesView feature_set_name, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema) {
    (void)user_data;
    (void)view;
    (void)feature_set_name;
    if (out_arrow_array != NULL) {
        *out_arrow_array = NULL;
    }
    if (out_arrow_schema != NULL) {
        *out_arrow_schema = NULL;
    }
    return DAG_ML_DATA_STATUS_OK;
}

int main(void) {
    DagMlDataVTable table = {0};
    DagMlDataString error = {0};
    DagMlDataString out = {0};
    DagMlDataTensorF64 tensor = {0};
    DagMlDataTensorF32 tensor_f32 = {0};
    DagMlDataFeatureMatrixF64View matrix = {0};
    DagMlDataFeatureMatrixF64ColumnarView columnar = {0};
    ArrowArray *array = NULL;
    ArrowSchema *schema = NULL;

    table.abi_version = DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION;
    table.materialize = materialize;
    table.make_view = make_view;
    table.view_identity = view_identity;
    table.target_arrow = target_arrow;
    table.feature_arrow = feature_arrow;

    (void)dagmldata_version();
    (void)dagmldata_coordinator_feature_fusion_arrow_json((const uint8_t*)"{}", 2, &array, &schema, &error);
    (void)dagmldata_coordinator_feature_collation_json((const uint8_t*)"{}", 2, &error, &error);
    (void)dagmldata_coordinator_feature_collation_tensor_f64_json((const uint8_t*)"{}", 2, &tensor, &error);
    (void)dagmldata_coordinator_feature_collation_tensor_f32_json((const uint8_t*)"{}", 2, &tensor_f32, &error);
    (void)dagmldata_inmemory_provider_new_json((const uint8_t*)"{}", 2, NULL, 0, &table, &error);
    (void)dagmldata_inmemory_provider_new_with_features_json((const uint8_t*)"{}", 2, NULL, 0, NULL, 0, &table, &error);
    (void)dagmldata_inmemory_provider_new_with_f64_features_json((const uint8_t*)"{}", 2, NULL, 0, NULL, 0, &table, &error);
    (void)dagmldata_inmemory_provider_new_with_f64_feature_views((const uint8_t*)"{}", 2, NULL, 0, &matrix, 1, &table, &error);
    (void)dagmldata_inmemory_provider_new_with_f64_feature_columns((const uint8_t*)"{}", 2, NULL, 0, &columnar, 1, &table, &error);
    (void)dagmldata_inmemory_provider_new_from_file((const uint8_t*)"{}", 2, NULL, 0, (const uint8_t*)"/tmp/nonexistent.n4d", 20, &table, &error);
    DagMlDataBufferFetcherVTable fetcher = {0};
    fetcher.abi_version = DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION;
    (void)dagmldata_inmemory_provider_new_with_buffer_fetcher((const uint8_t*)"{}", 2, NULL, 0, fetcher, NULL, 0, &table, &error);
    (void)dagmldata_inmemory_provider_feature_collation_json(&table, 0, (DagMlDataBytesView){0}, &out, &error);
    (void)dagmldata_inmemory_provider_feature_collation_tensor_f64_json(&table, 0, (DagMlDataBytesView){0}, &tensor, &error);
    (void)dagmldata_inmemory_provider_feature_collation_tensor_f32_json(&table, 0, (DagMlDataBytesView){0}, &tensor_f32, &error);
    (void)dagmldata_fitted_adapter_ref_validate_json((const uint8_t*)"{}", 2, 0, &error);
    (void)dagmldata_fitted_adapter_manifest_validate_json((const uint8_t*)"{}", 2, 0, &error);
    DagMlDataFittedAdapterStoreHandle fitted_store = {0};
    uint64_t fitted_handle = 0;
    uint8_t fitted_released = 0;
    (void)dagmldata_inmemory_fitted_adapter_store_new(&fitted_store);
    (void)dagmldata_inmemory_fitted_adapter_store_register_json(fitted_store, (const uint8_t*)"{}", 2, &fitted_handle, &error);
    (void)dagmldata_inmemory_fitted_adapter_store_materialize_json(fitted_store, (const uint8_t*)"{}", 2, &fitted_handle, &error);
    (void)dagmldata_inmemory_fitted_adapter_store_release(fitted_store, (const uint8_t*)"snv", 3, &fitted_released);
    (void)dagmldata_inmemory_provider_attach_fitted_adapter_store(&table, fitted_store, &error);
    {
        uint64_t adapter_handle = 0;
        (void)dagmldata_inmemory_provider_materialize_fitted_adapter_json(&table, (const uint8_t*)"{}", 2, &adapter_handle, &error);
    }
    dagmldata_inmemory_fitted_adapter_store_destroy(fitted_store);
    dagmldata_arrow_array_free(array);
    dagmldata_arrow_schema_free(schema);
    dagmldata_tensor_f64_free(tensor);
    dagmldata_tensor_f32_free(tensor_f32);
    dagmldata_inmemory_provider_destroy(&table);
    return 0;
}
"#;
    let path = std::env::temp_dir().join(format!(
        "dag_ml_data_c_header_smoke_{}.c",
        std::process::id()
    ));
    fs::write(&path, source).expect("write C header smoke source");

    let output = Command::new("cc")
        .arg("-std=c11")
        .arg("-fsyntax-only")
        .arg("-I")
        .arg(format!("{manifest_dir}/include"))
        .arg(&path)
        .output()
        .expect("run C compiler");
    let _ = fs::remove_file(&path);

    assert!(
        output.status.success(),
        "C header smoke failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn c_headers_can_be_included_with_dag_ml_peer() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf();
    let Some(peer) = dag_ml_peer_root(&workspace) else {
        eprintln!("skipping cross-header smoke; dag-ml checkout not found");
        return;
    };
    let peer_include = peer.join("crates/dag-ml-capi/include");
    assert!(
        peer_include.exists(),
        "dag-ml include directory not found at {}",
        peer_include.display()
    );

    let sources = [
        (
            "dag_ml_data_first",
            r#"
#include "dag_ml_data.h"
#include "dag_ml.h"

int main(void) {
#if DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION != 2u
#error unexpected data-provider ABI version
#endif
    DagMlDataVTable table = {0};
    DagMlDataTensorF64 tensor = {0};
    DagMlDataTensorF32 tensor_f32 = {0};
    table.abi_version = DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION;
    tensor.abi_version = DAG_ML_DATA_TENSOR_F64_ABI_VERSION;
    tensor_f32.abi_version = DAG_ML_DATA_TENSOR_F32_ABI_VERSION;
    return table.abi_version == 0 || tensor.abi_version == 0 || tensor_f32.abi_version == 0;
}
"#,
        ),
        (
            "dag_ml_first",
            r#"
#include "dag_ml.h"
#include "dag_ml_data.h"

int main(void) {
#if DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION != 2u
#error unexpected data-provider ABI version
#endif
    DagMlDataVTable table = {0};
    DagMlDataTensorF64 tensor = {0};
    DagMlDataTensorF32 tensor_f32 = {0};
    table.abi_version = DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION;
    tensor.abi_version = DAG_ML_DATA_TENSOR_F64_ABI_VERSION;
    tensor_f32.abi_version = DAG_ML_DATA_TENSOR_F32_ABI_VERSION;
    return table.abi_version == 0 || tensor.abi_version == 0 || tensor_f32.abi_version == 0;
}
"#,
        ),
    ];

    for (name, source) in sources {
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_cross_header_{name}_{}_{}.c",
            std::process::id(),
            unique_suffix()
        ));
        fs::write(&path, source).expect("write cross-header smoke source");
        let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
        let output = Command::new(cc)
            .arg("-std=c11")
            .arg("-fsyntax-only")
            .arg("-I")
            .arg(manifest_dir.join("include"))
            .arg("-I")
            .arg(&peer_include)
            .arg(&path)
            .output()
            .expect("run C compiler");
        let _ = fs::remove_file(&path);
        assert!(
            output.status.success(),
            "cross-header smoke `{name}` failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn c_program_links_and_exercises_inmemory_provider_vtable() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
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
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_root.join("target"));
    let lib_dir = target_dir.join("debug");
    let source = r#"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "dag_ml_data.h"

typedef struct Bytes {
    uint8_t *ptr;
    size_t len;
} Bytes;

static int read_file(const char *path, Bytes *out) {
    FILE *file = fopen(path, "rb");
    long len;
    if (file == NULL) {
        return 1;
    }
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        return 2;
    }
    len = ftell(file);
    if (len < 0) {
        fclose(file);
        return 3;
    }
    if (fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        return 4;
    }
    out->ptr = (uint8_t *)malloc((size_t)len);
    out->len = (size_t)len;
    if (out->ptr == NULL && out->len != 0) {
        fclose(file);
        return 5;
    }
    if (fread(out->ptr, 1, out->len, file) != out->len) {
        fclose(file);
        return 6;
    }
    fclose(file);
    return 0;
}

int main(int argc, char **argv) {
    Bytes envelope = {0};
    Bytes request = {0};
    const uint8_t target_tables[] = "[{\"target_id\":\"y\",\"values\":[{\"sample_id\":\"S001\",\"value\":42.0},{\"sample_id\":\"S002\",\"value\":7.0}]}]";
    const DagMlDataBytesView feature_names[] = {
        {(const uint8_t *)"f0", sizeof("f0") - 1},
        {(const uint8_t *)"f1", sizeof("f1") - 1},
    };
    const DagMlDataBytesView observation_ids[] = {
        {(const uint8_t *)"obs.S001.base", sizeof("obs.S001.base") - 1},
        {(const uint8_t *)"obs.S001.rep1", sizeof("obs.S001.rep1") - 1},
        {(const uint8_t *)"obs.S001.aug0", sizeof("obs.S001.aug0") - 1},
        {(const uint8_t *)"obs.S002.base", sizeof("obs.S002.base") - 1},
    };
    const double feature_values[] = {1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0};
    const DagMlDataFeatureMatrixF64View feature_matrices[] = {{
        {(const uint8_t *)"x", sizeof("x") - 1},
        {(const uint8_t *)"tabular_numeric", sizeof("tabular_numeric") - 1},
        feature_names,
        2,
        observation_ids,
        4,
        feature_values,
        8,
        NULL,
        0,
    }};
    const uint8_t view_json[] = "{\"sample_ids\":[\"S001\"],\"columns\":[\"f1\"],\"include_augmented\":false}";
    const uint8_t target_name[] = "y";
    const uint8_t feature_set_name[] = "x";
    const uint8_t tensor_selector[] = "{\"feature_set_id\":\"x\",\"policy\":{\"emit_mask\":true}}";
    DagMlDataVTable vtable = {0};
    DagMlDataString error = {0};
    DagMlDataHandle data_handle = 0;
    DagMlDataHandle view_handle = 0;
    ArrowArray *identity_array = NULL;
    ArrowSchema *identity_schema = NULL;
    ArrowArray *target_array = NULL;
    ArrowSchema *target_schema = NULL;
    ArrowArray *feature_array = NULL;
    ArrowSchema *feature_schema = NULL;
    DagMlDataTensorF64 tensor = {0};
    DagMlDataTensorF32 tensor_f32 = {0};
    DagMlDataStatusCode status;

    if (argc != 3) {
        return 2;
    }
    if (read_file(argv[1], &envelope) != 0 || read_file(argv[2], &request) != 0) {
        return 3;
    }

    status = dagmldata_inmemory_provider_new_with_f64_feature_views(
        envelope.ptr,
        envelope.len,
        target_tables,
        sizeof(target_tables) - 1,
        feature_matrices,
        1,
        &vtable,
        &error
    );
    if (status != DAG_ML_DATA_STATUS_OK || vtable.user_data == NULL || error.ptr != NULL) {
        return 10;
    }
    status = vtable.materialize(
        vtable.user_data,
        0,
        (DagMlDataBytesView){request.ptr, request.len},
        &data_handle
    );
    if (status != DAG_ML_DATA_STATUS_OK || data_handle == 0) {
        return 11;
    }
    status = vtable.make_view(
        vtable.user_data,
        data_handle,
        (DagMlDataBytesView){view_json, sizeof(view_json) - 1},
        &view_handle
    );
    if (status != DAG_ML_DATA_STATUS_OK || view_handle == 0) {
        return 12;
    }
    status = vtable.view_identity(vtable.user_data, view_handle, &identity_array, &identity_schema);
    if (status != DAG_ML_DATA_STATUS_OK || identity_array == NULL || identity_array->length != 2) {
        return 13;
    }
    dagmldata_arrow_array_free(identity_array);
    dagmldata_arrow_schema_free(identity_schema);

    status = vtable.target_arrow(
        vtable.user_data,
        view_handle,
        (DagMlDataBytesView){target_name, sizeof(target_name) - 1},
        &target_array,
        &target_schema
    );
    if (status != DAG_ML_DATA_STATUS_OK || target_array == NULL || target_array->length != 1) {
        return 14;
    }
    dagmldata_arrow_array_free(target_array);
    dagmldata_arrow_schema_free(target_schema);

    status = vtable.feature_arrow(
        vtable.user_data,
        view_handle,
        (DagMlDataBytesView){feature_set_name, sizeof(feature_set_name) - 1},
        &feature_array,
        &feature_schema
    );
    if (status != DAG_ML_DATA_STATUS_OK || feature_array == NULL || feature_array->length != 2 || feature_array->n_children != 3) {
        return 15;
    }
    dagmldata_arrow_array_free(feature_array);
    dagmldata_arrow_schema_free(feature_schema);

    status = dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
        &vtable,
        view_handle,
        (DagMlDataBytesView){tensor_selector, sizeof(tensor_selector) - 1},
        &tensor,
        &error
    );
    if (status != DAG_ML_DATA_STATUS_OK || tensor.abi_version != DAG_ML_DATA_TENSOR_F64_ABI_VERSION || tensor.shape.len != 2 || tensor.values.len != 2 || tensor.values.ptr[0] != 10.0 || tensor.values.ptr[1] != 20.0) {
        return 16;
    }
    if (tensor.shape.ptr[0] != 2 || tensor.shape.ptr[1] != 1 || tensor.presence_mask.len != 2) {
        return 17;
    }

    status = dagmldata_inmemory_provider_feature_collation_tensor_f32_json(
        &vtable,
        view_handle,
        (DagMlDataBytesView){tensor_selector, sizeof(tensor_selector) - 1},
        &tensor_f32,
        &error
    );
    if (status != DAG_ML_DATA_STATUS_OK || tensor_f32.abi_version != DAG_ML_DATA_TENSOR_F32_ABI_VERSION || tensor_f32.shape.len != 2 || tensor_f32.values.len != 2) {
        return 18;
    }
    if (tensor_f32.values.ptr[0] != (float)tensor.values.ptr[0] || tensor_f32.values.ptr[1] != (float)tensor.values.ptr[1]) {
        return 19;
    }
    if (tensor_f32.shape.ptr[0] != tensor.shape.ptr[0] || tensor_f32.shape.ptr[1] != tensor.shape.ptr[1] || tensor_f32.presence_mask.len != tensor.presence_mask.len) {
        return 20;
    }
    dagmldata_tensor_f32_free(tensor_f32);
    dagmldata_tensor_f64_free(tensor);

    vtable.release(vtable.user_data, view_handle);
    vtable.release(vtable.user_data, data_handle);
    dagmldata_inmemory_provider_destroy(&vtable);
    free(envelope.ptr);
    free(request.ptr);
    return 0;
}
"#;
    let pid = std::process::id();
    let source_path = std::env::temp_dir().join(format!("dag_ml_data_linked_smoke_{pid}.c"));
    let exe_path = std::env::temp_dir().join(format!("dag_ml_data_linked_smoke_{pid}"));
    fs::write(&source_path, source).expect("write linked C smoke source");

    let compile = Command::new("cc")
        .arg("-std=c11")
        .arg("-I")
        .arg(manifest_dir.join("include"))
        .arg(&source_path)
        .arg("-L")
        .arg(&lib_dir)
        .arg("-ldag_ml_data_capi")
        .arg(format!("-Wl,-rpath,{}", lib_dir.display()))
        .arg("-o")
        .arg(&exe_path)
        .output()
        .expect("compile linked C smoke");
    assert!(
        compile.status.success(),
        "C linked smoke compile failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&compile.stdout),
        String::from_utf8_lossy(&compile.stderr)
    );

    let run = Command::new(&exe_path)
        .arg(
            workspace_root
                .join("examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"),
        )
        .arg(
            workspace_root
                .join("examples/fixtures/oof_campaign/materialization_request_model_base_x.json"),
        )
        .output()
        .expect("run linked C smoke");
    let _ = fs::remove_file(&source_path);
    let _ = fs::remove_file(&exe_path);

    assert!(
        run.status.success(),
        "C linked smoke failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        run.status.code(),
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr)
    );
}

fn dag_ml_peer_root(workspace: &Path) -> Option<PathBuf> {
    std::env::var_os("DAG_ML_REPO")
        .map(PathBuf::from)
        .into_iter()
        .chain([
            workspace.parent()?.join("dag-ml"),
            workspace.join("external/dag-ml"),
        ])
        .find(|candidate| candidate.exists())
        .map(|candidate| candidate.canonicalize().unwrap_or(candidate))
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time after unix epoch")
        .as_nanos()
}
