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
      health: true,
      scientific_submission_transport: true,
      native_archive_v2_prediction: true,
      scientific_execution: false,
      native_job_status_routes: true,
      native_job_cancellation_routes: true,
      durable_execution_job_record_reads: true,
      system_capabilities_route: true,
      workspace_transition_status_route: true,
      legacy_workspace_conversion_route: true,
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

  it("keeps native Rust routes selected when packaged stdio execution is ready", async () => {
    const request = vi.fn().mockImplementation(
      async () => capabilityResponse({
        scientific_execution: true,
        python_plugin_execution: true,
        python_plugin_preflight: true,
      }),
    );

    for (const candidate of [
      { kind: "http" as const, method: "GET", path: "/health" },
      { kind: "http" as const, method: "POST", path: "/runs/run-groups" },
      { kind: "http" as const, method: "POST", path: "/predict/archive-v2" },
      { kind: "http" as const, method: "GET", path: "/training/job-1" },
      { kind: "http" as const, method: "GET", path: "/system/capabilities" },
      { kind: "websocket" as const, path: "/ws/job/job-1" },
    ]) {
      await expect(preselectRendererTransport(
        candidate,
        running,
        request,
      )).resolves.toMatchObject({
        target: "native-sidecar",
        base_url: "http://127.0.0.1:43123",
        renderer_transport: true,
        scientific_execution: false,
        reason: "native_capability_preflight_passed",
        fallback_after_native_selection: "none",
        status: 200,
      });
    }
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("still rejects malformed execution capability, transport, and Python owner", async () => {
    const malformedExecution = vi.fn().mockResolvedValue(
      capabilityResponse({ scientific_execution: "available" }),
    );
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/health" },
      running,
      malformedExecution,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_capability_mismatch",
      status: 503,
    });

    const wrongTransport = vi.fn().mockResolvedValue(capabilityResponse({
      renderer_http_transport: false,
      scientific_execution: true,
    }));
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/health" },
      running,
      wrongTransport,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_capability_mismatch",
      status: 503,
    });

    const wrongOwnerCapability = vi.fn().mockResolvedValue(capabilityResponse({
      scientific_execution: true,
      python_plugin_execution: true,
      python_plugin_preflight: false,
    }));
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/system/capabilities" },
      running,
      wrongOwnerCapability,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_capability_mismatch",
      status: 503,
    });

    const noRequest = vi.fn();
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/system/capabilities" },
      () => ({
        status: "running",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
      noRequest,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_python_host_unavailable",
      status: 503,
    });
    expect(noRequest).not.toHaveBeenCalled();
  });

  it("selects Archive V2 prediction without acquiring the explicit Python host", async () => {
    const request = vi.fn().mockResolvedValue(capabilityResponse());
    const withoutPythonHost = () => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    });

    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/predict/archive-v2" },
      withoutPythonHost,
      request,
    )).resolves.toMatchObject({
      surface: "archive-v2-prediction",
      target: "native-sidecar",
      base_url: "http://127.0.0.1:43123",
      reason: "native_capability_preflight_passed",
      status: 200,
    });

    const refused = vi.fn().mockResolvedValue(
      capabilityResponse({ native_archive_v2_prediction: false }),
    );
    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/predict/archive-v2" },
      withoutPythonHost,
      refused,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_capability_mismatch",
      status: 503,
    });
  });

  it("selects Rust-owned transition detection and bounded Tools conversion separately", async () => {
    const request = vi.fn().mockResolvedValue(capabilityResponse());
    const withoutPythonHost = () => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    });

    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/workspace/transition-status" },
      withoutPythonHost,
      request,
    )).resolves.toMatchObject({
      surface: "workspace-transition-status",
      target: "native-sidecar",
    });
    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/workspace/legacy-convert" },
      withoutPythonHost,
      request,
    )).resolves.toMatchObject({
      surface: "legacy-workspace-conversion",
      target: "reject",
      reason: "native_python_host_unavailable",
      status: 503,
    });
    expect(request).toHaveBeenCalledOnce();

    const configuredRequest = vi.fn().mockResolvedValue(
      capabilityResponse({ python_plugin_preflight: true }),
    );
    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/workspace/legacy-convert" },
      running,
      configuredRequest,
    )).resolves.toMatchObject({
      surface: "legacy-workspace-conversion",
      target: "native-sidecar",
      reason: "native_capability_preflight_passed",
    });
    expect(configuredRequest).toHaveBeenCalledOnce();
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
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/predict/archive-v2" },
      running,
      request,
    )).resolves.toMatchObject({
      target: "reject",
      reason: "native_route_contract_mismatch",
      status: 400,
    });
    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/predict/archive-v2?debug=true" },
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
