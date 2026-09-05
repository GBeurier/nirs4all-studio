"""Fresh-process witnesses for the packaged pure-document closure (no API server)."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = r'''
import json, socket, sys
sys.path.insert(0,sys.argv[1])
def deny(event,args):
    if event == "socket.bind" or event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}:
        raise RuntimeError("ownership denied")
sys.addaudithook(deny)
from studio_document_adapters.api.library_documents import adapt_document
request=json.load(sys.stdin)
try:
    value=adapt_document(request["operation"],request["payload"])
    result={"ok":True,"value":value}
except Exception as error:
    result={"ok":False,"error":str(error)}
result["forbidden_imports"]=[name for name in sys.modules if name.split(".")[0] in {"fastapi","starlette","uvicorn","api"}]
print(json.dumps(result,allow_nan=False))
'''


class DocumentAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="studio-document-test-")
        subprocess.run(
            ["node", "-e", "require('./scripts/studio-document-adapters.cjs').installAdapters(process.cwd(),process.argv[1])", cls.directory.name],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def invoke(self, operation, payload):
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", SCRIPT, self.directory.name],
            input=json.dumps({"operation": operation, "payload": payload}),
            check=True, capture_output=True, text=True, timeout=30,
            cwd=self.directory.name, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        value = json.loads(result.stdout)
        self.assertEqual(value["forbidden_imports"], [])
        return value

    def test_canonical_import_render_preserves_general_model_and_preprocessing(self):
        canonical = {"name": "General ridge", "pipeline": [
            {"class": "sklearn.preprocessing.StandardScaler"},
            {"class": "sklearn.linear_model.Ridge", "params": {"alpha": 0.25}},
        ]}
        imported = self.invoke("pipeline.import", {"payload": canonical})
        self.assertTrue(imported["ok"], imported)
        rendered = self.invoke("pipeline.render", imported["value"])
        self.assertTrue(rendered["ok"], rendered)
        self.assertIn("Ridge", rendered["value"]["json"])
        self.assertIn("0.25", rendered["value"]["json"])
        reimported = self.invoke("pipeline.import", {"content": rendered["value"]["yaml"], "format": "yaml"})
        self.assertTrue(reimported["ok"], reimported)
        self.assertEqual(len(reimported["value"]["steps"]), 2)

    def test_unapproved_code_is_refused_before_canonical_deserialization(self):
        for payload in [
            {"pipeline": [{"class": "os.system", "params": {"command": "false"}}]},
            {"steps": [{"type": "model", "classPath": "subprocess.Popen", "name": "bad", "params": {}}]},
        ]:
            value = self.invoke("pipeline.import", {"payload": payload})
            self.assertFalse(value["ok"])
            self.assertIn("requires explicit authorization", value["error"])

    def test_folder_detection_is_delegated_and_relative_wizard_files_are_rooted(self):
        with tempfile.TemporaryDirectory(prefix="studio-dataset-doc-") as directory:
            # Invalid matrix contents prove this operation resolves filenames,
            # without opening or validating numerical data in Studio.
            Path(directory, "Xcal.csv").write_text("not-a-matrix", encoding="utf-8")
            Path(directory, "Ycal.csv").write_text("not-targets", encoding="utf-8")
            folder = self.invoke("dataset.configure", {"record": {"path": directory, "config": {}}})
            self.assertTrue(folder["ok"], folder)
            self.assertEqual(folder["value"]["train_x"], str(Path(directory, "Xcal.csv")))
            self.assertEqual(folder["value"]["train_y"], str(Path(directory, "Ycal.csv")))
        configured = self.invoke("dataset.configure", {"record": {
            "path": "/datasets/example", "name": "Example", "config": {"files": [
                {"path": "X.csv", "type": "X", "split": "train"},
                {"path": "y.csv", "type": "Y", "split": "train"},
            ]},
        }})
        self.assertTrue(configured["ok"], configured)
        self.assertIn("/datasets/example/X.csv", json.dumps(configured["value"]))


if __name__ == "__main__":
    unittest.main()
