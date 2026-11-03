use nirs4all_io::api::{load_assembled, Input};
use serde_json::json;

#[test]
fn headerless_targets_and_metadata_keep_first_row_in_both_partitions() {
    let root = tempfile::tempdir().unwrap();
    let mut config = json!({"global_params":{"delimiter":";","has_header":true}});
    for partition in ["train", "test"] {
        for (role, text) in [
            ("x", "1;2\n3;4\n5;6\n"),
            ("y", "101\n102\n103\n"),
            ("group", "first\nsecond\nthird\n"),
        ] {
            let path = root.path().join(format!("{partition}_{role}.csv"));
            std::fs::write(&path, text).unwrap();
            config[format!("{partition}_{role}")] = json!(path);
            config[format!("{partition}_{role}_params")] = json!({"has_header":false});
        }
    }
    let assembled = load_assembled(&Input::Spec(config), None, None).unwrap();
    for partition in ["train", "test"] {
        let block = &assembled.blocks[partition];
        assert_eq!(block.n_samples, 3);
        assert_eq!(block.x[0].data, vec![1., 2., 3., 4., 5., 6.]);
        assert_eq!(block.y.as_ref().unwrap().data, vec![101., 102., 103.]);
        let metadata = block.metadata.as_ref().unwrap();
        assert_eq!(metadata.n_rows, 3);
        assert_eq!(metadata.columns[0].values[0].to_str_scalar(), "first");
    }
}
