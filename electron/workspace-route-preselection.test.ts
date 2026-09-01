import { describe, expect, it, vi } from "vitest";

import { preselectWorkspaceRunDetail } from "./workspace-route-preselection";

const nativeDecision = {
  schema_id: "nirs4all.studio-run-detail-preselection-decision.v1" as const,
  workspace_id: "workspace-a",
  target: "native-sidecar" as const,
  verified_store_v5: true,
  store_schema_version: 5 as const,
  reason: "store_v5_owner_materializer_ready",
  fallback_after_native_selection: "none" as const,
};

describe("workspace run-detail route preselection", () => {
  it("selects native only after Store v5 and owner host preflight", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(nativeDecision), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      preselectWorkspaceRunDetail(
        "workspace-a",
        () => ({ status: "running", url: "http://127.0.0.1:43123" }),
        request,
      ),
    ).resolves.toEqual({ ...nativeDecision, status: 200 });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/sidecar/v1/workspaces/workspace-a/run-detail-preselection",
      { method: "GET" },
    );
  });

  it("selects the scientific plugin before HTTP when the sidecar is unavailable", async () => {
    const request = vi.fn();
    const decision = await preselectWorkspaceRunDetail(
      "workspace-a",
      () => ({ status: "stopped", url: null }),
      request,
    );

    expect(decision.target).toBe("scientific-plugin");
    expect(decision.reason).toBe("native_sidecar_unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an unreachable or malformed native verifier instead of guessing", async () => {
    const unreachable = await preselectWorkspaceRunDetail(
      "workspace-a",
      () => ({ status: "running", url: "http://127.0.0.1:43123" }),
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    expect(unreachable).toMatchObject({
      target: "reject",
      status: 503,
      reason: "native_preselection_unreachable",
    });

    const malformed = await preselectWorkspaceRunDetail(
      "workspace-a",
      () => ({ status: "running", url: "http://127.0.0.1:43123" }),
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    expect(malformed).toMatchObject({
      target: "reject",
      status: 500,
      reason: "invalid_native_preselection_response",
    });
  });
});
