use std::{env, ffi::OsString, fs, path::Path, path::PathBuf, process::Command, time::SystemTime};

use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde_json::Value;
use studio_sidecar::run_detail_cpython::materialize_run_detail_owner_from_connection;

fn test_directory() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    env::temp_dir().join(format!(
        "studio-run-detail-owner-differential-{}-{nonce}",
        std::process::id()
    ))
}

#[derive(Debug, Eq, PartialEq)]
struct SourceMember {
    name: OsString,
    bytes: Vec<u8>,
    length: u64,
    modified: SystemTime,
}

fn source_snapshot(root: &Path) -> Vec<SourceMember> {
    let mut members = fs::read_dir(root)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            let metadata = entry.metadata().unwrap();
            assert!(metadata.is_file());
            SourceMember {
                name: entry.file_name(),
                bytes: fs::read(entry.path()).unwrap(),
                length: metadata.len(),
                modified: metadata.modified().unwrap(),
            }
        })
        .collect::<Vec<_>>();
    members.sort_by(|left, right| left.name.cmp(&right.name));
    members
}

fn compare_authenticated_snapshot_with_separate_owner_oracle(python: &Path, live_wal: bool) {
    let root = test_directory();
    let source = root.join("source");
    let oracle_workspace = root.join("oracle");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&oracle_workspace).unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let database = source.join("store.sqlite");
    fs::copy(fixtures.join("workspace_store_v5.sqlite"), &database).unwrap();
    let run_id = "12345678-1234-5678-1234-567812345678";
    let writer = Connection::open(&database).unwrap();
    let expected_name = if live_wal {
        assert_eq!(
            writer
                .query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        writer.execute_batch("PRAGMA wal_autocheckpoint=0").unwrap();
        writer
            .execute(
                "UPDATE runs SET name='committed WAL owner witness' WHERE run_id=?",
                [run_id],
            )
            .unwrap();
        Some("committed WAL owner witness")
    } else {
        // A closed standalone fixture must not retain the golden's WAL header.
        // This changes only this test copy, before the no-mutation baseline.
        assert_eq!(
            writer
                .query_row("PRAGMA journal_mode=DELETE", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "delete"
        );
        None
    };
    let writer = if live_wal {
        Some(writer)
    } else {
        drop(writer);
        None
    };
    let connection = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .unwrap();
    connection
        .execute_batch("PRAGMA query_only=ON; BEGIN")
        .unwrap();
    let visible_name = connection
        .query_row("SELECT name FROM runs WHERE run_id=?", [run_id], |row| {
            row.get::<_, String>(0)
        })
        .unwrap();
    if let Some(name) = expected_name {
        assert_eq!(visible_name, name);
        assert!(!fs::read(&database)
            .unwrap()
            .windows(name.len())
            .any(|window| window == name.as_bytes()));
        assert!(fs::metadata(source.join("store.sqlite-wal")).unwrap().len() > 0);
    }
    // The independent oracle owns its copy: its SQLite coordination files must
    // never be attributed to the Rust bridge's authenticated user source.
    let serialized = connection.serialize(DatabaseName::Main).unwrap();
    fs::write(oracle_workspace.join("store.sqlite"), &*serialized).unwrap();
    drop(serialized);
    let before = source_snapshot(&source);

    let actual = materialize_run_detail_owner_from_connection(python, &connection, run_id)
        .unwrap()
        .expect("fixture run must exist");
    assert_eq!(source_snapshot(&source), before);
    let oracle = Command::new(python)
        .args([
            "-I",
            "-B",
            "-c",
            "import json,sys\nfrom nirs4all.pipeline.storage import studio_run_detail_http_inputs_v1\nprint(json.dumps(studio_run_detail_http_inputs_v1(sys.argv[1],sys.argv[2]),allow_nan=False,separators=(',',':'),sort_keys=True))",
        ])
        .arg(&oracle_workspace)
        .arg(run_id)
        .output()
        .unwrap();
    assert!(oracle.status.success());
    assert_eq!(oracle.stderr, [] as [u8; 0]);
    let expected: Value = serde_json::from_slice(&oracle.stdout).unwrap();
    assert_eq!(actual, expected);
    if let Some(name) = expected_name {
        assert_eq!(actual["run_detail"]["name"], name);
    } else {
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(!PathBuf::from(format!("{}{suffix}", database.display())).exists());
        }
    }
    assert_eq!(source_snapshot(&source), before);
    drop(connection);
    drop(writer);
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires NIRS4ALL_RUN_DETAIL_OWNER_PYTHON with nirs4all installed"]
fn fresh_isolated_cpython_matches_the_direct_owner_oracle_without_mutation() {
    let python = PathBuf::from(
        env::var_os("NIRS4ALL_RUN_DETAIL_OWNER_PYTHON")
            .expect("NIRS4ALL_RUN_DETAIL_OWNER_PYTHON is required"),
    );
    compare_authenticated_snapshot_with_separate_owner_oracle(&python, false);
    compare_authenticated_snapshot_with_separate_owner_oracle(&python, true);
}
