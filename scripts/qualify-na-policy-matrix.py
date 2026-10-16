"""Stress the installed native IO with deliberately awkward CSV observations."""
import json
import sys
from pathlib import Path

import nirs4all_io as nio


def qualify(root: Path) -> list[dict]:
    """Check original row identities under each explicit policy and CSV dialect."""
    root.mkdir(parents=True, exist_ok=True)
    results = []
    for newline_name, newline in [("lf", "\n"), ("crlf", "\r\n"), ("cr", "\r")]:
        for header in (True, False):
            for categorical in (True, False):
                case = root / f"{newline_name}-header{int(header)}-class{int(categorical)}"
                case.mkdir(exist_ok=True)
                x = case / "x.csv"
                y = case / "y.csv"
                x.write_bytes((newline.join((["w"] if header else []) + ["1", "2", "3", "4"]) + newline).encode("utf-8"))
                labels = ["", "pass", "NA", "fail"] if categorical else ["", "10", "NA", "30"]
                y.write_bytes((newline.join((["y"] if header else []) + labels) + newline).encode("utf-8"))
                for policy in ("ignore", "remove_sample", "abort", "replace", "remove_feature"):
                    na = {"policy": policy}
                    if policy == "replace":
                        na["fill"] = {"method": "value", "fill_value": "unknown" if categorical else 7}
                    spec = {"params": {"has_header": header}, "sources": [
                        {"id": "x", "role": "features", "input": str(x)},
                        {"id": "y", "role": "targets", "input": str(y), "params": {"na": na}},
                    ]}
                    try:
                        block = nio.assembled_full(spec)["blocks"]["train"]
                    except ValueError as error:
                        assert policy == "abort" and "NA" in str(error), (case, policy, error)
                        results.append({"case": case.name, "policy": policy, "strict_refusal": True})
                        continue
                    assert policy != "abort", (case, "Strict policy accepted NA")
                    expected_x = [2, 4] if policy == "remove_sample" else [1, 2, 3, 4]
                    assert block["x"][0]["data"] == expected_x, (case, policy, block)
                    if policy == "remove_feature":
                        assert block["y"] is None, (case, policy, block)
                    else:
                        data = block["y"]["data"]
                        assert len(data) == len(expected_x), (case, policy, block)
                        assert sum(value is None for value in data) == (2 if policy == "ignore" else 0), (case, policy, data)
                        if categorical:
                            categories = next(iter(block["y_categorical"].values()))["categories"]
                            assert set(categories) == ({"pass", "fail", "unknown"} if policy == "replace" else {"pass", "fail"})
                        elif policy == "remove_sample":
                            assert data == [10, 30], (case, data)
                        elif policy == "replace":
                            assert data == [7, 10, 7, 30], (case, data)
                    results.append({"case": case.name, "policy": policy, "rows": block["n_samples"], "passed": True})
    return results


if __name__ == "__main__":
    target = Path(sys.argv[1]).resolve()
    report = {"io_version": nio.__version__, "cases": qualify(target)}
    (target / "qualification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"io_version": nio.__version__, "passed": len(report["cases"])}))
