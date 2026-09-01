import { describe, expect, it, vi } from "vitest";

import { preselectRendererTransport } from "./renderer-transport-selection";

const running = () => ({
  status: "running" as const,
  url: "http://127.0.0.1:43123",
  pythonPluginHostConfigured: true,
});

function capabilityResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    protocol_version: "studio-sidecar-r1",
    features: {
      renderer_transport_selection: true,
      renderer_rust_only_default: true,
      implicit_python_http_fallback: false,
      unmigrated_renderer_routes_fail_closed: true,
      renderer_http_transport: true,
      renderer_websocket_transport: true,
      scientific_submission_transport: true,
      scientific_execution: false,
      native_job_status_routes: true,
      native_job_cancellation_routes: true,
      durable_execution_job_record_reads: true,
      system_capabilities_route: true,
      ...overrides,
    },
  }), { status: 200 });
}

describe("renderer transport preselection", () => {
  it("selects scientific submission transport natively only after capabilities preflight", async () => {
    const request = vi.fn().mockResolvedValue(capabilityResponse());
    const decision = await preselectRendererTransport(
      { kind: "http", method: "POST", path: "/runs/run-groups" },
      running,
      request,
    );

    expect(decision).toEqual({
      schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1",
      kind: "http",
      method: "POST",
      path: "/runs/run-groups",
      surface: "scientific-submission",
      target: "native-sidecar",
      base_url: "http://127.0.0.1:43123",
      renderer_transport: true,
      scientific_execution: false,
      reason: "native_capability_preflight_passed",
      fallback_after_native_selection: "none",
      status: 200,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/sidecar/v1/capabilities",
      { method: "GET", cache: "no-store" },
    );
  });

  it("rejects a native candidate before target request when sidecar or capability is unavailable", async () => {
    const noRequest = vi.fn();
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/training/job-1" },
      () => ({ status: "stopped", url: null }),
      noRequest,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_sidecar_unavailable",
      status: 503,
    });
    expect(noRequest).not.toHaveBeenCalled();

    const mismatch = vi.fn().mockResolvedValue(
      capabilityResponse({ native_job_status_routes: false }),
    );
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/training/job-1" },
      running,
      mismatch,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_capability_mismatch",
      status: 503,
    });
  });

  it("rejects unmigrated HTTP and WebSocket routes without inspecting or acquiring Python", async () => {
    const info = vi.fn(running);
    const request = vi.fn();
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/datasets" },
      info,
      request,
    )).resolves.toMatchObject({
      target: "reject",
      surface: "unmigrated",
      reason: "route_not_native_qualified_rust_only",
      status: 501,
    });
    await expect(preselectRendererTransport(
      { kind: "websocket", path: "/ws" },
      info,
      request,
    )).resolves.toMatchObject({
      target: "reject",
      surface: "unmigrated",
      reason: "route_not_native_qualified_rust_only",
      status: 501,
    });
    expect(info).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("uses Python HTTP only as an explicit session-wide diagnostic owner", async () => {
    const info = vi.fn(running);
    const request = vi.fn();
    const policy = { pythonHttpDiagnosticEnabled: true };

    for (const candidate of [
      { kind: "http" as const, method: "POST", path: "/training/start" },
      { kind: "http" as const, method: "GET", path: "/training/job-1" },
      { kind: "http" as const, method: "POST", path: "/training/job-1/stop" },
      { kind: "websocket" as const, path: "/ws/training/job-1" },
    ]) {
      await expect(preselectRendererTransport(
        candidate,
        info,
        request,
        policy,
      )).resolves.toMatchObject({
        target: "scientific-plugin",
        surface: "python-http-diagnostic",
        reason: "explicit_python_http_diagnostic_mode",
        fallback_after_native_selection: "none",
      });
    }

    expect(info).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("selects only bounded job WebSockets and keeps scientific execution false", async () => {
    const request = vi.fn().mockResolvedValue(capabilityResponse());
    await expect(preselectRendererTransport(
      { kind: "websocket", path: "/ws/training/job-1" },
      running,
      request,
    )).resolves.toMatchObject({
      target: "native-sidecar",
      surface: "job-training-websocket",
      renderer_transport: true,
      scientific_execution: false,
    });

    const invalid = await preselectRendererTransport(
      { kind: "websocket", path: "/ws/job/../secret" },
      running,
      request,
    );
    expect(invalid).toMatchObject({
      target: "reject",
      reason: "native_route_contract_mismatch",
      status: 400,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown input fields and a missing bounded Python host", async () => {
    const request = vi.fn();
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/health", retry: true },
      running,
      request,
    )).resolves.toMatchObject({ target: "reject", status: 400 });

    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/system/capabilities" },
      () => ({
        status: "running",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
      request,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_python_host_unavailable",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects native-shaped query and method drift instead of reclassifying it as Python", async () => {
    const request = vi.fn();
    await expect(preselectRendererTransport(
      {
        kind: "http",
        method: "GET",
        path: "/workspaces/workspace-a/runs?source=legacy",
      },
      running,
      request,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_route_contract_mismatch",
      status: 400,
    });
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/runs/run-groups" },
      running,
      request,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_route_contract_mismatch",
      status: 400,
    });
    expect(request).not.toHaveBeenCalled();
  });
});
