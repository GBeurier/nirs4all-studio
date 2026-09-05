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

    def test_all_shipped_preset_variants_import_and_roundtrip_without_http(self):
        import yaml

        from api.pipeline_canonical import canonical_to_editor, editor_to_canonical

        paths = sorted((ROOT / "api/presets").glob("*.yaml"))
        self.assertEqual(len(paths), 10)
        import re

        embedded = re.findall(r'include_str!\("../../(api/presets/[^"\n]+)"\)', (ROOT / "sidecar/src/pipeline_presets.rs").read_text(encoding="utf-8"))
        self.assertEqual(sorted(embedded), [str(path.relative_to(ROOT)) for path in paths])
        for path in paths:
            preset = yaml.safe_load(path.read_text(encoding="utf-8"))
            for variant, configured in preset["variants"].items():
                with self.subTest(preset=preset["id"], variant=variant):
                    canonical = {"name": preset["name"], "description": preset["description"], "pipeline": configured["pipeline"]}
                    imported = self.invoke("pipeline.import", {"payload": canonical})
                    self.assertTrue(imported["ok"], imported)
                    rendered = self.invoke("pipeline.render", imported["value"])
                    self.assertTrue(rendered["ok"], rendered)
                    # Preserve the existing editor translation contract through
                    # the packaged seam; UUIDs are not pipeline semantics.
                    expected = editor_to_canonical(canonical_to_editor(canonical), name=preset["name"], description=preset["description"], include_wrapper=True)
                    self.assertEqual(rendered["value"]["payload"], expected)

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

    def test_source_and_variation_documents_are_not_replaced_by_folder_detection(self):
        for config in [
            {"sources": [{"name": "NIR", "train_x": "nir.csv"}, {"name": "MIR", "train_x": "mir.csv"}], "targets": "y.csv"},
            {"variations": [{"name": "raw", "train_x": "raw.csv"}, {"name": "snv", "train_x": "snv.csv"}], "targets": "y.csv"},
        ]:
            configured = self.invoke("dataset.configure", {"record": {"path": "/datasets/example", "config": config}})
            self.assertTrue(configured["ok"], configured)
            encoded = json.dumps(configured["value"])
            self.assertIn("/datasets/example/y.csv", encoded)
            self.assertIn("/datasets/example/" + ("nir.csv" if "sources" in config else "raw.csv"), encoded)

    def test_document_batch_preserves_order_and_refuses_nested_or_import_operations(self):
        configured = self.invoke("documents.batch", {"requests": [
            {"operation": "dataset.configure", "payload": {"record": {"path": "/datasets/example", "config": {"train_x": "X.csv", "train_y": "Y.csv"}}}},
            {"operation": "pipeline.normalize", "payload": {"steps": [{"type": "model", "name": "Ridge", "params": {"alpha": 0.5}}]}},
        ]})
        self.assertTrue(configured["ok"], configured)
        self.assertEqual(len(configured["value"]), 2)
        self.assertIn("/datasets/example/X.csv", json.dumps(configured["value"][0]))
        self.assertIn("runtime_pipeline", configured["value"][1])
        for operation in ("documents.batch", "pipeline.import", "run"):
            refused = self.invoke("documents.batch", {"requests": [{"operation": operation, "payload": {}}]})
            self.assertFalse(refused["ok"], refused)

    def test_worker_encoder_checks_utf8_budget_before_writing_any_partial_response(self):
        source = (ROOT / "sidecar/src/scientific_cpython.rs").read_text(encoding="utf-8")
        encoder = "encoded=bytearray()" + source.split("encoded=bytearray()", 1)[1].split('"#;', 1)[0]
        for response, limit, succeeds in [({"value": "é"}, 32, True), ({"items": list(range(1000))}, 32, False)]:
            script = "import json,sys\nresponse=" + repr(response) + "\nresponse_limit=" + str(limit) + "\n" + encoder
            result = subprocess.run([sys.executable, "-I", "-B", "-c", script], capture_output=True, timeout=10)
            if succeeds:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), response)
                self.assertLessEqual(len(result.stdout), limit)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
                self.assertIn(b"exceeds stdout budget", result.stderr)

    def test_runtime_comparison_uses_metadata_without_http_or_installation(self):
        config = {"profiles": {"cpu": {"label": "CPU", "packages": {"packaging": {"min": ">=20"}}}}, "optional": {}}
        compared = self.invoke("config.compare", {"config": config, "profile": "cpu", "include_latest": True})
        self.assertTrue(compared["ok"], compared)
        self.assertTrue(compared["value"]["is_aligned"])
        self.assertFalse(compared["value"]["latest_lookup_performed"])
        refused = self.invoke("config.compare", {"config": config, "profile": "cpu", "install": True})
        self.assertFalse(refused["ok"], refused)


if __name__ == "__main__":
    unittest.main()
