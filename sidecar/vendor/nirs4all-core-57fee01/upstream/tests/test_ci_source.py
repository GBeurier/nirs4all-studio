"""The CI source guard accepts current branches without weakening tag repair."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ci_source", ROOT / "scripts/check_ci_source.py")
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SourceGuardTests(unittest.TestCase):
    def test_branch_qualification_does_not_require_historical_tag(self):
        with patch.object(MODULE.subprocess, "run") as run:
            MODULE.validate_source(ROOT, methods_ref="a" * 40)
            run.assert_not_called()

    def test_mutable_or_malformed_methods_ref_is_refused(self):
        for value in ["main", "v1.0.16", "A" * 40, "$(false)"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                MODULE.validate_source(ROOT, methods_ref=value)

    def test_tag_repair_requires_matching_version_and_ancestry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "bindings/rust/nirs4all/Cargo.toml"
            manifest.parent.mkdir(parents=True)
            manifest.write_text('[package]\nversion = "0.3.28"\n')
            with patch.object(MODULE.subprocess, "run") as run:
                MODULE.validate_source(root, repair_tag="v0.3.28")
                run.assert_called_once_with(
                    ["git", "merge-base", "--is-ancestor", "refs/tags/v0.3.28", "HEAD"],
                    cwd=root, check=True,
                )
            with self.assertRaises(ValueError):
                MODULE.validate_source(root, repair_tag="v0.3.25")

    def test_malformed_tag_is_refused_before_git(self):
        with self.assertRaises(ValueError):
            MODULE.validate_source(ROOT, repair_tag="--help")


if __name__ == "__main__":
    unittest.main()
