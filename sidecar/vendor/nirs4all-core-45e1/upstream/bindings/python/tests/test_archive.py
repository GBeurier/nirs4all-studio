"""The Python Archive V2 facade only delegates to the native aggregate."""

from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

from nirs4all_core import (
    NativeArchiveUnavailableError,
    read_portable_predictor_package_v2,
    read_portable_refit_package_v3,
    replay_methods_archive_v2,
    replay_methods_archive_v2_conformal_presentation_v1,
    replay_methods_archive_v3,
    write_archive_v2_from_native_payloads,
    write_archive_v3_from_native_payloads,
)


class ArchiveFacadeTests(unittest.TestCase):
    def test_returns_exact_native_package_bytes(self) -> None:
        observed: list[str] = []

        def read(path: str) -> bytes:
            observed.append(path)
            return b'{"schema_version":2}'

        module = types.SimpleNamespace(read_portable_predictor_package_v2=read)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            result = read_portable_predictor_package_v2("/tmp/model.n4a")

        self.assertEqual(result, b'{"schema_version":2}')
        self.assertEqual(observed, ["/tmp/model.n4a"])

    def test_missing_native_bridge_fails_closed(self) -> None:
        with patch.dict(sys.modules, {"nirs4all_core._native": None}):
            with self.assertRaises(NativeArchiveUnavailableError):
                read_portable_predictor_package_v2("/tmp/model.n4a")

    def test_returns_exact_native_refit_package_v3_bytes(self) -> None:
        observed: list[str] = []

        def read(path: str) -> bytes:
            observed.append(path)
            return b'{"schema_version":3}'

        module = types.SimpleNamespace(read_portable_refit_package_v3=read)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            result = read_portable_refit_package_v3("/tmp/model.n4a")

        self.assertEqual(result, b'{"schema_version":3}')
        self.assertEqual(observed, ["/tmp/model.n4a"])

    def test_v2_replay_forwards_strict_json_without_callbacks(self) -> None:
        observed: list[object] = []

        def replay(*args: object) -> str:
            observed.extend(args)
            return '{"outcome_id":"outcome:predict","schema_version":2}'

        module = types.SimpleNamespace(replay_methods_archive_v2_json=replay)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            outcome = replay_methods_archive_v2(
                "/tmp/model.n4a",
                {"schema_version": 1, "request_id": "request:predict"},
                {"node.input": {"schema_version": 2}},
                {
                    "node.input": {
                        "sample_ids": ["sample:1"],
                        "x": [[1.0]],
                        "target_names": ["y"],
                    }
                },
                methods_library_path="/opt/lib/libn4m.so",
                outcome_id="outcome:predict",
                run_id="run:predict",
                warnings=["portable"],
                diagnostics={"source": "test"},
            )

        self.assertEqual(outcome["outcome_id"], "outcome:predict")
        self.assertEqual(observed[0], "/tmp/model.n4a")
        self.assertEqual(
            observed[1],
            '{"request_id":"request:predict","schema_version":1}',
        )
        self.assertEqual(observed[4:7], ["/opt/lib/libn4m.so", "outcome:predict", "run:predict"])
        self.assertEqual(observed[7], '["portable"]')
        self.assertEqual(observed[8], '{"source":"test"}')

    def test_v3_replay_uses_distinct_native_entry_point(self) -> None:
        observed: list[object] = []

        def replay(*args: object) -> str:
            observed.extend(args)
            return '{"outcome_id":"outcome:refit","schema_version":3}'

        module = types.SimpleNamespace(replay_methods_archive_v3_json=replay)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            outcome = replay_methods_archive_v3(
                "/tmp/refit.n4a",
                "{}",
                "{}",
                "{}",
                methods_library_path="/opt/lib/libn4m.so",
                outcome_id="outcome:refit",
                run_id="run:refit",
            )

        self.assertEqual(outcome, {"outcome_id": "outcome:refit", "schema_version": 3})
        self.assertEqual(observed[0], "/tmp/refit.n4a")
        self.assertEqual(observed[7:], ["[]", "{}"])

    def test_conformal_presentation_uses_distinct_native_entry_point(self) -> None:
        observed: list[object] = []

        def replay(*args: object) -> str:
            observed.extend(args)
            return '{"schema_version":1,"presentation_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'

        module = types.SimpleNamespace(
            replay_methods_archive_v2_conformal_presentation_v1_json=replay
        )
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            presentation = replay_methods_archive_v2_conformal_presentation_v1(
                "/tmp/calibrated.n4a",
                {"schema_version": 1},
                {"node.input": {"schema_version": 1}},
                {"node.input": {"sample_ids": ["sample:1"], "x": [[1.0]], "target_names": ["y"]}},
                methods_library_path="/opt/lib/libn4m.so",
                outcome_id="outcome:conformal.predict",
                run_id="run:conformal.predict",
            )

        self.assertEqual(presentation["schema_version"], 1)
        self.assertEqual(observed[0], "/tmp/calibrated.n4a")
        self.assertEqual(observed[4:7], ["/opt/lib/libn4m.so", "outcome:conformal.predict", "run:conformal.predict"])

    def test_conformal_presentation_missing_native_entry_point_fails_closed(self) -> None:
        module = types.SimpleNamespace(replay_methods_archive_v2_json=lambda *_: "{}")
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            with self.assertRaises(NativeArchiveUnavailableError):
                replay_methods_archive_v2_conformal_presentation_v1(
                    "/tmp/calibrated.n4a",
                    {},
                    {},
                    {},
                    methods_library_path="/opt/lib/libn4m.so",
                    outcome_id="outcome:conformal.predict",
                    run_id="run:conformal.predict",
                )

    def test_replay_missing_native_entry_point_fails_closed(self) -> None:
        module = types.SimpleNamespace(read_portable_predictor_package_v2=lambda _: b"{}")
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            with self.assertRaises(NativeArchiveUnavailableError):
                replay_methods_archive_v2(
                    "/tmp/model.n4a",
                    {},
                    {},
                    {},
                    methods_library_path="/opt/lib/libn4m.so",
                    outcome_id="outcome:predict",
                    run_id="run:predict",
                )

    def test_replay_refuses_non_finite_host_json_before_native_call(self) -> None:
        called = False

        def replay(*_: object) -> str:
            nonlocal called
            called = True
            return "{}"

        module = types.SimpleNamespace(replay_methods_archive_v2_json=replay)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            with self.assertRaises(TypeError):
                replay_methods_archive_v2(
                    "/tmp/model.n4a",
                    {},
                    {},
                    {"node.input": {"x": [[float("nan")]]}},
                    methods_library_path="/opt/lib/libn4m.so",
                    outcome_id="outcome:predict",
                    run_id="run:predict",
                )
        self.assertFalse(called)

    def test_writer_forwards_opaque_dagml_members_without_zip_logic(self) -> None:
        observed: list[object] = []

        def write(path: str, manifest: dict[str, object], members: list[tuple[str, bytes]]) -> tuple[str, str]:
            observed.extend([path, manifest, members])
            return ("archive:v2", "a" * 64)

        module = types.SimpleNamespace(write_archive_v2_from_native_payloads=write)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            reference = write_archive_v2_from_native_payloads(
                "/tmp/model.n4a",
                {"schema_version": 2},
                {"dagml/package.json": bytearray([1, 2]), "methods/model.n4mm": b"raw"},
            )

        self.assertEqual(reference, {"archive_id": "archive:v2", "archive_sha256": "a" * 64})
        self.assertEqual(observed[0], "/tmp/model.n4a")
        self.assertEqual(observed[1], {"schema_version": 2})
        self.assertEqual(
            observed[2],
            [("dagml/package.json", b"\x01\x02"), ("methods/model.n4mm", b"raw")],
        )

    def test_writer_rejects_non_bytes_before_native_call(self) -> None:
        with self.assertRaises(TypeError, msg="non-byte payload must be refused"):
            write_archive_v2_from_native_payloads(
                "/tmp/model.n4a", {"schema_version": 2}, {"member": "not-bytes"}
            )

    def test_v3_writer_forwards_opaque_dagml_members_without_zip_logic(self) -> None:
        observed: list[object] = []

        def write(path: str, manifest: dict[str, object], members: list[tuple[str, bytes]]) -> tuple[str, str]:
            observed.extend([path, manifest, members])
            return ("archive:v3", "b" * 64)

        module = types.SimpleNamespace(write_archive_v3_from_native_payloads=write)
        with patch.dict(sys.modules, {"nirs4all_core._native": module}):
            reference = write_archive_v3_from_native_payloads(
                "/tmp/refit.n4a",
                {"schema_version": 3},
                {"dagml/refit.json": memoryview(b"refit"), "methods/model.n4mm": b"raw"},
            )

        self.assertEqual(reference, {"archive_id": "archive:v3", "archive_sha256": "b" * 64})
        self.assertEqual(observed[0], "/tmp/refit.n4a")
        self.assertEqual(observed[1], {"schema_version": 3})
        self.assertEqual(
            observed[2],
            [("dagml/refit.json", b"refit"), ("methods/model.n4mm", b"raw")],
        )

    def test_v3_writer_rejects_non_bytes_before_native_call(self) -> None:
        with self.assertRaises(TypeError, msg="non-byte payload must be refused"):
            write_archive_v3_from_native_payloads(
                "/tmp/refit.n4a", {"schema_version": 3}, {"member": "not-bytes"}
            )
