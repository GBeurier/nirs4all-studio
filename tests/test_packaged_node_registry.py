"""The installed Python backend must resolve the names shown by the UI palette."""
import json
from pathlib import Path
import shutil
import subprocess
import sys


def test_source_installer_contains_the_same_operator_registry(tmp_path):
    repository = Path(__file__).resolve().parent.parent
    subprocess.run([shutil.which("node"), "scripts/copy-backend-source.cjs", "--clean"], cwd=repository, check=True, capture_output=True)
    package_root = tmp_path / "installed-backend"
    shutil.copytree(repository / "backend-dist", package_root)
    # -I excludes the source checkout and user packages. Only packaged data is visible.
    result = subprocess.run([
        sys.executable, "-I", "-c",
        "import json,sys;sys.path.insert(0,'.');"
        "from api.node_registry_loader import load_editor_registry_nodes;"
        "print(json.dumps({node['name']:node.get('classPath') for node in load_editor_registry_nodes()}))",
    ], cwd=package_root, check=True, capture_output=True, text=True)
    packaged = json.loads(result.stdout)
    expected = {}
    for definition in (repository / "src/data/nodes/definitions").rglob("*.json"):
        for node in json.loads(definition.read_text()):
            if node.get("classPath"):
                expected[node["name"]] = node["classPath"]
    assert len(expected) > 100
    assert packaged["SNV"] == "nirs4all.operators.transforms.StandardNormalVariate"
    for name, class_path in expected.items():
        assert packaged[name] == class_path, name
