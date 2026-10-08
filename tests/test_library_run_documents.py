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


if __name__ == "__main__":
    unittest.main()
