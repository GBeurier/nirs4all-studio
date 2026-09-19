"""Exercise real scientific HTTP behavior in the built recovery container."""
import json
import math
import os
import time
import urllib.request

url = os.environ.get("RECOVERY_BASE_URL", "http://127.0.0.1:8000") + "/api/playground/execute"
x = [[math.sin(j / 17 + i / 100) + i / 80 + j / 256 for j in range(256)] for i in range(1000)]
payload = {
    "data": {"x": x},
    "steps": [{"id": "snv", "type": "preprocessing", "name": "SNV", "params": {}}],
    "options": {"compute_pca": False},
}
request = urllib.request.Request(
    url, data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json", "Accept": "application/json"},
)
started = time.monotonic()
with urllib.request.urlopen(request, timeout=10) as response:
    result = json.load(response)
elapsed = time.monotonic() - started
assert result["success"], result.get("step_errors")
assert any(step["success"] and step["name"] in ("SNV", "StandardNormalVariate") for step in result["execution_trace"])
spectra = result["processed"]["spectra"]
assert spectra
for row in spectra:
    assert len(row) == 256 and all(math.isfinite(value) for value in row)
    mean = sum(row) / len(row)
    variance = sum((value - mean) ** 2 for value in row) / len(row)
    assert abs(mean) < 1e-5 and abs(variance - 1) < 0.02, (mean, variance)
assert elapsed < 10, elapsed
print(json.dumps({"success": True, "samples": 1000, "features": 256, "snv_seconds": elapsed}))
