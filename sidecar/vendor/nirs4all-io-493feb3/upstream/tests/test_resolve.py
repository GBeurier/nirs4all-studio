# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for the resolver: identity, hashing, ordering, sidecars, in-memory."""

from __future__ import annotations

import numpy as np

from nirs4all_io.resolve import resolve


def _write(path, text="a,b\n1,2\n"):
    path.write_text(text, encoding="utf-8")
    return path


def test_resolve_directory_ordered_with_hashes(tmp_path):
    _write(tmp_path / "Xcal.csv")
    _write(tmp_path / "Ycal.csv", "y\n3\n")
    iset = resolve(tmp_path)
    assert iset.origin["kind"] == "directory"
    assert iset.names == ["Xcal.csv", "Ycal.csv"]  # deterministic (sorted)
    for item in iset.items:
        assert item.kind == "file"
        assert item.identity.endswith(item.ref) or item.ref in item.identity
        assert item.content_hash and len(item.content_hash) == 64
        assert item.extension == ".csv"


def test_resolve_glob_and_file_list(tmp_path):
    _write(tmp_path / "a.csv")
    _write(tmp_path / "b.csv")
    _write(tmp_path / "note.txt", "hello")
    glob_set = resolve(str(tmp_path / "*.csv"))
    assert sorted(i.hints["basename"] for i in glob_set.items) == ["a.csv", "b.csv"]
    list_set = resolve([str(tmp_path / "a.csv"), str(tmp_path / "note.txt")])
    assert {i.hints["basename"] for i in list_set.items} == {"a.csv", "note.txt"}


def test_content_hash_distinguishes_content(tmp_path):
    _write(tmp_path / "x.csv", "a\n1\n")
    h1 = resolve(tmp_path).items[0].content_hash
    _write(tmp_path / "x.csv", "a\n2\n")
    h2 = resolve(tmp_path).items[0].content_hash
    assert h1 != h2


def test_sidecar_grouping_envi(tmp_path):
    (tmp_path / "cube.img").write_bytes(b"\x00\x01\x02")
    (tmp_path / "cube.hdr").write_text("ENVI\nsamples = 2\n", encoding="utf-8")
    iset = resolve(tmp_path)
    # the .hdr is attached to the .img primary, not a standalone item
    assert iset.names == ["cube.img"]
    assert iset.items[0].sidecars and iset.items[0].sidecars[0].endswith("cube.hdr")


def test_recursive_directory(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    _write(tmp_path / "top.csv")
    _write(sub / "deep.csv")
    flat = resolve(tmp_path, recursive=False)
    deep = resolve(tmp_path, recursive=True)
    assert flat.names == ["top.csv"]
    assert set(deep.names) == {"top.csv", "sub/deep.csv"}


def test_resolve_in_memory_arrays():
    X = np.zeros((4, 3))
    y = np.arange(4)
    seq = resolve([X, y])
    assert [i.kind for i in seq.items] == ["array", "array"]
    assert seq.items[0].hints["shape"] == [4, 3]
    mapping = resolve({"X": X, "y": y})
    assert {i.ref for i in mapping.items} == {"X", "y"}
    assert all(i.content_hash for i in mapping.items)


def test_resolve_single_ndarray():
    iset = resolve(np.ones((2, 2)))
    assert len(iset.items) == 1 and iset.items[0].kind == "array"
