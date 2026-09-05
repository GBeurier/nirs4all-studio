use super::*;

#[test]
fn catalogue_preserves_all_authored_variants_and_order_without_python() {
    let presets = catalogue().unwrap();
    assert_eq!(presets.len(), 10);
    assert_eq!(presets[0]["id"], "simple_pls");
    assert_eq!(presets[9]["id"], "ultra_slow");
    for preset in presets {
        assert_eq!(
            preset["available_variants"],
            json!(["regression", "classification"])
        );
        assert_eq!(
            preset["pipeline"],
            preset["variants"]["regression"]["pipeline"]
        );
        for variant in ["regression", "classification"] {
            let (payload, selected) = selection(
                preset["id"].as_str().unwrap(),
                json!({"variant":variant}).to_string().as_bytes(),
            )
            .unwrap();
            assert_eq!(selected, variant);
            assert_eq!(
                payload["payload"]["pipeline"],
                preset["variants"][variant]["pipeline"]
            );
            assert_eq!(payload["payload"]["name"], preset["name"]);
        }
    }
}

#[test]
fn selection_preserves_defaults_and_explicit_name_and_normalizes_variant() {
    let (default, variant) = selection("simple_pls", b"").unwrap();
    assert_eq!(variant, "regression");
    assert_eq!(default["payload"]["name"], "Simple PLS");
    let (custom, variant) = selection(
        "simple_pls",
        br#"{"name":"My classifier","variant":" Classification "}"#,
    )
    .unwrap();
    assert_eq!(variant, "classification");
    assert_eq!(custom["payload"]["name"], "My classifier");
    for request in [
        b"{}".as_slice(),
        b"null",
        br#"{"name":null,"variant":null}"#,
        br#"{"name":"","variant":""}"#,
    ] {
        assert_eq!(selection("simple_pls", request).unwrap().0, default);
    }
}

#[test]
fn unknown_ids_variants_and_malformed_bodies_never_reach_conversion() {
    for id in ["missing", "../simple_pls", "simple_pls/other", ""] {
        assert_eq!(selection(id, b"{}").unwrap_err().0, 404);
    }
    for body in [
        b"[]".as_slice(),
        b"invalid",
        br#"{"name":42}"#,
        br#"{"variant":true}"#,
        br#"{"variant":"clustering"}"#,
    ] {
        assert_eq!(selection("simple_pls", body).unwrap_err().0, 400);
    }
    assert_eq!(
        selection(
            "simple_pls",
            &vec![b' '; crate::document_cpython::MAX_DOCUMENT_BYTES + 1]
        )
        .unwrap_err()
        .0,
        413
    );
}

#[test]
fn browsing_needs_neither_workspace_nor_host_and_failed_import_does_not_write() {
    let root = tempfile::tempdir().unwrap();
    let settings = AppSettingsStore::with_config_paths(
        root.path().join("config"),
        root.path().join("defaults"),
    );
    let response = route(&settings, None, "GET", "/api/pipelines/presets", b"").unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&response.body).unwrap()["total"],
        10
    );
    assert_eq!(
        route(
            &settings,
            None,
            "POST",
            "/api/pipelines/from-preset/simple_pls",
            b"{}"
        )
        .unwrap()
        .status,
        503
    );
    assert_eq!(
        route(
            &settings,
            None,
            "POST",
            "/api/pipelines/from-preset/missing",
            b"{}"
        )
        .unwrap()
        .status,
        404
    );
    assert!(route(&settings, None, "DELETE", "/api/pipelines/presets", b"").is_none());
    assert!(route(&settings, None, "POST", "/api/pipelines", b"{}").is_none());
    assert_eq!(root.path().read_dir().unwrap().count(), 0);
}

#[test]
fn invalid_bundled_presets_fail_explicitly_instead_of_shrinking_the_catalogue() {
    for source in [
        "{}",
        "id: invalid\nvariants: {}",
        "variants: {clustering: {}}",
    ] {
        assert!(normalize(source).is_err());
    }
}
