import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmScientificHost, describeActiveRuns } from "./scientific-host";

const URL = "http://127.0.0.1:43123";
const PYTHON = "/envs/studio/bin/python";

/** A sidecar answering each path with the next queued body (the last one repeats). */
function sidecar(answers: Record<string, Array<{ status?: number; body: unknown }>>) {
  const requested: string[] = [];
  const request = vi.fn(async (url: string) => {
    const path = url.slice(URL.length);
    requested.push(path);
    const queue = answers[path];
    if (!queue) throw new Error(`unexpected request ${path}`);
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return { request, requested };
}

const loading = { body: { ml_ready: false, ml_loading: true } };
const ready = { body: { ml_ready: true, ml_loading: false } };
const coherent = { body: { coherent: true, running_python: PYTHON } };

afterEach(() => { vi.restoreAllMocks(); });

describe("scientific host confirmation", () => {
  it("asks which interpreter runs only after the host acquisition has finished", async () => {
    const { request, requested } = sidecar({
      "/api/system/readiness": [loading, loading, ready],
      "/api/system/env-coherence": [coherent],
    });

    await confirmScientificHost(URL, PYTHON, request, { pollMs: 1 });

    // The coherence probe imports nirs4all under a shorter limit than a cold acquisition.
    expect(requested).toEqual([
      "/api/system/readiness", "/api/system/readiness", "/api/system/readiness", "/api/system/env-coherence",
    ]);
  });

  it.each([
    ["studio_adapters_unavailable", "Studio's own Python adapters are missing from this installation"],
    ["scientific_distribution_missing", "nirs4all is not installed in it"],
    ["scientific_distribution_inconsistent", "the nirs4all installation in this environment is inconsistent; reinstall nirs4all or pick another environment"],
    ["scientific_distribution_version_unsupported", "its nirs4all version is outside the range Studio requires"],
    ["scientific_library_import_failed", "nirs4all is installed but could not be imported"],
    ["python_host_windows_system_root_unavailable", "Windows did not give Python its system directory (SystemRoot)"],
    ["python_host_timed_out", "the sidecar reported"],
  ])("explains a host that did not start (%s) without asking for coherence", async (code, reason) => {
    const { request, requested } = sidecar({
      "/api/system/readiness": [loading, { body: { ml_ready: false, ml_loading: false, ml_error: code } }],
    });

    await expect(confirmScientificHost(URL, PYTHON, request, { pollMs: 1 })).rejects.toThrow(
      `Studio could not start nirs4all in this Python environment: ${reason} (${code}).`,
    );
    expect(requested).not.toContain("/api/system/env-coherence");
  });

  it("gives up waiting for an acquisition that never ends", async () => {
    const { request } = sidecar({ "/api/system/readiness": [loading] });

    await expect(confirmScientificHost(URL, PYTHON, request, { waitMs: 20, pollMs: 5 })).rejects.toThrow(
      "Studio could not start nirs4all in this Python environment: no reason was reported.",
    );
  });

  it("refuses a sidecar that runs another interpreter or does not confirm the selected one", async () => {
    const other = sidecar({
      "/api/system/readiness": [ready],
      "/api/system/env-coherence": [{ body: { coherent: true, running_python: "/usr/bin/python3" } }],
    });
    await expect(confirmScientificHost(URL, PYTHON, other.request)).rejects.toThrow("using a different Python interpreter");

    const incoherent = sidecar({
      "/api/system/readiness": [ready],
      "/api/system/env-coherence": [{ body: { coherent: false, running_python: PYTHON } }],
    });
    await expect(confirmScientificHost(URL, PYTHON, incoherent.request)).rejects.toThrow("did not activate the selected Python environment");

    const unavailable = sidecar({
      "/api/system/readiness": [ready],
      "/api/system/env-coherence": [{ status: 503, body: { detail: "unavailable" } }],
    });
    await expect(confirmScientificHost(URL, PYTHON, unavailable.request)).rejects.toThrow("did not activate the selected Python environment");
  });
});

describe("active runs", () => {
  it("describes the runs queued or running in this session", async () => {
    const one = sidecar({ "/api/runs/stats": [{ body: { running: 1, queued: 0, completed: 12 } }] });
    expect(await describeActiveRuns(URL, one.request)).toBe("A run is in progress.");
    const several = sidecar({ "/api/runs/stats": [{ body: { running: 1, queued: 2 } }] });
    expect(await describeActiveRuns(URL, several.request)).toBe("3 runs are in progress.");
  });

  it("is null when nothing runs or the sidecar cannot answer", async () => {
    const idle = sidecar({ "/api/runs/stats": [{ body: { running: 0, queued: 0, completed: 4 } }] });
    expect(await describeActiveRuns(URL, idle.request)).toBeNull();
    const failing = sidecar({ "/api/runs/stats": [{ status: 500, body: { detail: "store unavailable" } }] });
    expect(await describeActiveRuns(URL, failing.request)).toBeNull();
    expect(await describeActiveRuns(URL, async () => { throw new Error("connection refused"); })).toBeNull();
  });
});
