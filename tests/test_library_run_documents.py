"""Exercise history operations against a real disposable Store-v5 database."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from api.library_documents import adapt_document


class RunDocumentsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        fixture = Path(__file__).parents[1] / "sidecar/tests/fixtures/workspace_store_v5_summary.sqlite"
        shutil.copy2(fixture, self.root / "store.sqlite")
        import sqlite3
        with sqlite3.connect(self.root / "store.sqlite") as connection:
            self.run_id = connection.execute("SELECT run_id FROM runs LIMIT 1").fetchone()[0]
            self.pipeline_id = connection.execute("SELECT pipeline_id FROM pipelines LIMIT 1").fetchone()[0]
        connection.close()

    def tearDown(self):
        self.temporary.cleanup()

    def test_detail_and_logs_preserve_the_store(self):
        database = self.root / "store.sqlite"
        before = database.read_bytes()
        detail = adapt_document("runs.detail", {"workspace_path": str(self.root), "run_id": self.run_id})
        self.assertEqual(detail["run_detail"]["run_id"], self.run_id)
        logs = adapt_document("runs.logs", {"workspace_path": str(self.root), "run_id": self.run_id, "pipeline_id": self.pipeline_id})
        self.assertEqual(logs["pipeline_id"], self.pipeline_id)
        self.assertEqual(database.read_bytes(), before)
        with self.assertRaises(ValueError):
            adapt_document("runs.logs", {"workspace_path": str(self.root), "run_id": "another", "pipeline_id": self.pipeline_id})

    def test_preflight_and_identifiers_are_closed(self):
        self.assertEqual(adapt_document("runs.preflight", {}), {
            "callable": "nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1", "ready": True,
        })
        with self.assertRaises(ValueError):
            adapt_document("runs.preflight", {"unexpected": True})
        for identifier in ("../other", "a/b", "a\\b", "", "..", "a\0b"):
            with self.assertRaises(ValueError):
                adapt_document("runs.detail", {"workspace_path": str(self.root), "run_id": identifier})

    def test_delete_cascades_and_retires_exact_legacy_documents(self):
        import sqlite3
        directory = self.root / "runs" / "legacy-job"
        directory.mkdir(parents=True)
        manifest = {"id": directory.name, "store_run_id": self.run_id}
        (directory / "manifest.json").write_text(json.dumps(manifest))
        native = self.root / "runs/native-job"
        native.mkdir()
        (native / "execution_job_record.json").write_text(json.dumps({"job_id": native.name, "driver": {"store_run_ids": [self.run_id]}}))
        result = adapt_document("runs.delete", {"workspace_path": str(self.root), "run_id": self.run_id})
        self.assertTrue(result["success"])
        self.assertGreater(result["deleted_rows"], 1)
        with sqlite3.connect(self.root / "store.sqlite") as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM runs WHERE run_id=?", [self.run_id]).fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pipelines WHERE run_id=?", [self.run_id]).fetchone()[0], 0)
        connection.close()
        self.assertFalse(directory.exists())
        self.assertFalse(native.exists())
        self.assertEqual(json.loads((self.root / ".nirs4all/deleted-runs/legacy-job/manifest.json").read_text()), manifest)
        self.assertFalse(adapt_document("runs.delete", {"workspace_path": str(self.root), "run_id": self.run_id})["success"])

    def test_delete_keeps_shared_job_and_unrelated_documents(self):
        from nirs4all.pipeline.storage import WorkspaceStore

        with WorkspaceStore(self.root) as store:
            other_id = store.begin_run(name="Keep child", config={}, datasets=[])
            store.complete_run(other_id, {})
        native = self.root / "runs" / "shared-job"
        native.mkdir(parents=True)
        original = {"job_id": native.name, "driver": {"store_run_ids": [self.run_id, other_id]}}
        (native / "execution_job_record.json").write_text(json.dumps(original))
        unrelated = self.root / "runs" / "unrelated"
        unrelated.mkdir()
        (unrelated / "manifest.json").write_text(json.dumps({"id": "wrong-directory", "store_run_id": self.run_id}))
        self.assertTrue(adapt_document("runs.delete", {"workspace_path": str(self.root), "run_id": self.run_id})["success"])
        self.assertEqual(json.loads((native / "execution_job_record.json").read_text()), original)
        self.assertTrue(unrelated.exists())


if __name__ == "__main__":
    unittest.main()
