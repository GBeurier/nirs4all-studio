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
      native_conformal_presentation_v2: true,
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
  it("qualifies populated result browsing, ranking and prediction arrays through the owner", async () => {
    const request = async () => capabilityResponse({ aggregated_prediction_result_routes: true, python_plugin_preflight: true });
    const paths = [
      "/aggregated-predictions",
      "/aggregated-predictions?dataset_name=Durum+wheat&metric=rmse&chain_id=chain-1",
      "/aggregated-predictions/top?metric=rmse&n=100&score_column=final_test_score",
      "/aggregated-predictions/chain/chain-1?metric=rmse&dataset_name=wheat",
      "/aggregated-predictions/chain/cha%C3%AEne/detail?partition=val&fold_id=0",
      "/aggregated-predictions/prediction-1/arrays",
      "/aggregated-predictions/chain/chain-1/pipeline-steps",
      "/aggregated-predictions/pipeline/pipeline-1/pipeline-steps",
    ];
    for (const path of paths) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "aggregated-prediction-results" });
    }
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path: paths[0] }, running, async () => capabilityResponse()))
      .resolves.toMatchObject({ target: "reject" });
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path: paths[0] },
      () => ({ ...running(), pythonPluginHostConfigured: false }), request))
      .resolves.toMatchObject({ target: "reject", reason: "native_python_host_unavailable" });
  });

  it("rejects unimplemented or malformed aggregated result contracts", async () => {
    const request = async () => capabilityResponse({ aggregated_prediction_result_routes: true, python_plugin_preflight: true });
    for (const path of [
      "/aggregated-predictions?path=/other/workspace",
      "/aggregated-predictions?metric=rmse&%6Detric=mae",
      "/aggregated-predictions?metric=",
      "/aggregated-predictions/top?n=2",
      "/aggregated-predictions/top?metric=rmse&n=101",
      "/aggregated-predictions/top?metric=rmse&n=-1",
      "/aggregated-predictions/top?metric=rmse&n=1.5",
      "/aggregated-predictions/top?metric=rmse&score_column=arbitrary_sql",
      "/aggregated-predictions/chain/id/detail?partition=invalid",
      "/aggregated-predictions/chain/%2F/arrays",
      "/aggregated-predictions/%2F/arrays",
      "/aggregated-predictions/%5C/arrays",
      "/aggregated-predictions/%00/arrays",
      "/aggregated-predictions/%ZZ/arrays",
      `/aggregated-predictions/${"x".repeat(257)}/arrays`,
      "/aggregated-predictions/id/arrays?partition=test",
      "/aggregated-predictions/id/robustness-evidence",
      "/aggregated-predictions/chain/chain-1/pipeline-steps?metric=rmse",
      "/aggregated-predictions/pipeline/%2F/pipeline-steps",
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/aggregated-predictions" }, running, request))
      .resolves.toMatchObject({ target: "reject" });
  });

  it("selects the actual Predictions page and summary contracts", async () => {
    const request = async () => capabilityResponse({ workspace_prediction_result_routes: true, python_plugin_preflight: true });
    for (const path of ["/workspaces/workspace-1/predictions/data?limit=1000&offset=0",
      "/workspaces/workspace-1/predictions/data?dataset=durum+wheat&partition=test",
      "/workspaces/workspace-1/predictions/summary"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "workspace-prediction-results" });
    }
    for (const suffix of ["limit=1001", "offset=-1", "limit=1&limit=2", "partition=oops", "path=/tmp/other"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path: `/workspaces/workspace-1/predictions/data?${suffix}` }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
  });

  it("requires the exact compact dataset-score capability without a Python host", async () => {
    const request = async () => capabilityResponse({ dataset_score_routes: true });
    const info = () => ({ ...running(), pythonPluginHostConfigured: false });
    const path = "/workspaces/workspace-1/results/dataset-scores";
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, info, request))
      .resolves.toMatchObject({ target: "native-sidecar" });
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path: `${path}?metric=rmse` }, info, request))
      .resolves.toMatchObject({ target: "reject" });
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, info, async () => capabilityResponse()))
      .resolves.toMatchObject({ target: "reject" });
  });

  it("selects the shared synthetic catalogue and only an attested generator", async () => {
    const request = async () => capabilityResponse({ dataset_synthetic_preset_routes: true });
    await expect(preselectRendererTransport({ kind: "http", method: "GET", path: "/datasets/synthetic-presets" },
      () => ({ ...running(), pythonPluginHostConfigured: false }), request))
      .resolves.toMatchObject({ target: "native-sidecar" });
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/datasets/generate-synthetic" }, running, request))
      .resolves.toMatchObject({ target: "reject" });
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/datasets/generate-synthetic" }, running,
      async () => capabilityResponse({ dataset_synthetic_generation_routes: true, python_plugin_preflight: true })))
      .resolves.toMatchObject({ target: "native-sidecar" });
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/datasets/generate-synthetic" },
      () => ({ ...running(), pythonPluginHostConfigured: false }), request))
      .resolves.toMatchObject({ target: "reject", reason: "native_python_host_unavailable" });
  });

  it("selects only the attested Playground surface", async () => {
    const request = async () => capabilityResponse({
      playground_routes: true,
      python_plugin_preflight: true,
    });
    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/playground/execute" },
      running,
      request,
    )).resolves.toMatchObject({ target: "native-sidecar", surface: "playground" });
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/playground/metadata-columns/dataset_1" },
      running,
      request,
    )).resolves.toMatchObject({ target: "native-sidecar", surface: "playground" });
    for (const path of ["/playground/operators", "/playground/presets", "/spectra/dataset_1", "/spectra/dataset_1?start=2&end=8&source=1&target_index=2&include_y=true", "/spectra/dataset_1/stats?partition=test&source=1"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "playground" });
    }
    for (const path of ["/playground/pca", "/playground/repetitions"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "POST", path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "playground" });
    }
    for (const path of ["/spectra/dataset_1?source=-1", "/spectra/dataset_1?source=1&source=2", "/spectra/dataset_1?include_y=yes", "/spectra/dataset_1/stats?start=2", "/spectra/dataset_1?max_wavelengths_returned=0"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
  });

  it("selects local update status and its explicit unsupported refresh", async () => {
    const request = async () => capabilityResponse({ updates_status_route: true });
    const info = () => ({ ...running(), pythonPluginHostConfigured: false });
    for (const [method, path] of [["GET", "/updates/status"], ["POST", "/updates/check"]]) {
      await expect(preselectRendererTransport({ kind: "http", method, path }, info, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "updates-status" });
    }
  });

  it("selects the complete native desktop-update lifecycle only with its capability", async () => {
    const request = async () => capabilityResponse({ native_webapp_update_routes: true });
    const info = () => ({ ...running(), pythonPluginHostConfigured: false });
    for (const [method, path] of [
      ["GET", "/updates/webapp/download-info"],
      ["GET", "/updates/webapp/changelog?current_version=0.11.1"],
      ["POST", "/updates/webapp/download-start"],
      ["GET", "/updates/webapp/download-status/update-1"],
      ["POST", "/updates/webapp/download-cancel/update-1"],
      ["POST", "/updates/webapp/apply"],
      ["GET", "/updates/webapp/staged-update"],
      ["DELETE", "/updates/webapp/staged-update"],
      ["POST", "/updates/webapp/cleanup"],
      ["GET", "/updates/webapp/last-apply-result"],
      ["DELETE", "/updates/webapp/last-apply-result"],
      ["POST", "/updates/webapp/restart"],
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method, path }, info, request))
        .resolves.toMatchObject({ target: "native-sidecar", surface: "webapp-update" });
    }
    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/updates/webapp/download-info" },
      info,
      async () => capabilityResponse(),
    )).resolves.toMatchObject({ target: "reject", reason: "native_capability_mismatch" });
    for (const path of [
      "/updates/webapp/download-info?url=http://evil",
      "/updates/webapp/changelog?current_version=0.11.1&extra=true",
      "/updates/webapp/download-status/../escape",
      "/updates/webapp/download-cancel/%2e%2e",
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, info, request))
        .resolves.toMatchObject({ target: "reject" });
    }
  });

  it("qualifies bounded dataset uploads and pipeline presets only when implemented", async () => {
    const request = async () => capabilityResponse({ dataset_import_routes: true, pipeline_preset_routes: true, python_plugin_preflight: true });
    for (const [method, path] of [["POST", "/datasets/upload"], ["POST", "/datasets/preview-upload"],
      ["POST", "/datasets/dataset_1/refresh"], ["GET", "/pipelines/presets"], ["POST", "/pipelines/from-preset/pls"]]) {
      await expect(preselectRendererTransport({ kind: "http", method, path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar" });
    }
    for (const path of ["/datasets/upload?metadata=unbounded", "/datasets/preview-upload?bad=1", "/pipelines/from-preset/pls?variant=regression"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "POST", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/datasets/upload" },
      () => ({ ...running(), pythonPluginHostConfigured: false }), request))
      .resolves.toMatchObject({ target: "reject", reason: "native_python_host_unavailable" });
  });
  it("selects qualified inspection, prediction and setup routes with their capabilities", async () => {
    const request = vi.fn().mockImplementation(async () => capabilityResponse({
      dataset_inspection_routes: true, recommended_config_routes: true, general_prediction_routes: true,
      python_plugin_preflight: true,
      workspace_run_history_route: true, workspace_run_listing_routes: true,
    }));
    for (const [method, path] of [
      ["GET", "/models/available"], ["POST", "/predict"], ["POST", "/predict/file"],
      ["GET", "/runs"], ["GET", "/runs/stats"], ["GET", "/runs?status=running,queued"],
      ["GET", "/workspaces/workspace_1/runs/enriched?project_id=project_1&limit=100&offset=0"],
      ["GET", "/config/recommended?force_refresh=false"], ["GET", "/config/detect-gpu"],
      ["GET", "/config/diff?profile=cpu&include_optional=true&include_latest=false"],
      ["GET", "/updates/dependencies"], ["GET", "/updates/dependencies?force_refresh=true"],
      ["POST", "/updates/dependencies/refresh"],
      ...["detect-files", "detect-unified", "detect-files-list", "scan-folder", "detect-format", "auto-detect", "validate-files", "preview"].map((operation) => ["POST", `/datasets/${operation}`]),
      ["GET", "/datasets/registered_1/preview?max_samples=5"], ["GET", "/datasets/registered_1/stats?partition=all"],
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method, path }, running, request))
        .resolves.toMatchObject({ target: "native-sidecar", status: 200 });
    }
    for (const path of ["/config/diff?include_optional=1", "/config/diff?profile=cpu&profile=gpu", "/config/recommended?bad=true",
      "/updates/dependencies?force_refresh=1", "/updates/dependencies?force_refresh=true&force_refresh=false",
      "/datasets/registered_1/preview?max_samples=-1", "/datasets/registered_1/stats?partition=other", "/models/available?bad=1",
      "/runs?status=oops", "/runs/stats?status=running", "/workspaces/workspace_1/runs/enriched?limit=1&limit=2", "/predict/models/available"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/datasets/preview-upload" }, running, request))
      .resolves.toMatchObject({ target: "reject" });
    for (const path of ["/updates/dependencies/install", "/updates/dependencies/uninstall", "/updates/dependencies/refresh?force_refresh=true", "/config/align"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "POST", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/predict" },
      () => ({ ...running(), pythonPluginHostConfigured: false }), request))
      .resolves.toMatchObject({ target: "reject", reason: "native_python_host_unavailable" });
    await expect(preselectRendererTransport({ kind: "http", method: "POST", path: "/predict" }, running,
      async () => capabilityResponse({ general_prediction_routes: false })))
      .resolves.toMatchObject({ target: "reject", reason: "native_capability_mismatch" });
  });
  it("qualifies implemented workspace and pipeline documents without a Python host", async () => {
    const request = vi.fn().mockImplementation(async () => capabilityResponse({
      workspace_document_routes: true,
      pipeline_document_routes: true,
      dataset_catalogue_routes: true,
      app_settings_routes: true,
    }));
    for (const [method, path] of [
      ["GET", "/workspace"], ["POST", "/workspace/create"],
      ["POST", "/workspace/select"], ["GET", "/workspace/list"],
      ["GET", "/pipelines"], ["POST", "/pipelines"],
      ["GET", "/pipelines/pipeline_1"], ["PUT", "/pipelines/pipeline_1"],
      ["DELETE", "/pipelines/pipeline_1"], ["GET", "/config/setup-status"],
      ["GET", "/datasets"], ["POST", "/datasets/link"], ["PUT", "/datasets/dataset_1"],
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method, path },
        () => ({ ...running(), pythonPluginHostConfigured: false }), request,
      )).resolves.toMatchObject({ target: "native-sidecar", status: 200 });
    }
    for (const path of ["/pipelines/presets", "/pipelines/../secret", "/pipelines/%2e%2e"]) {
      await expect(preselectRendererTransport({ kind: "http", method: "GET", path }, running, request))
        .resolves.toMatchObject({ target: "reject" });
    }
  });

  it("selects scientific submission transport natively only after capabilities preflight", async () => {
    const request = vi.fn().mockImplementation(async () => capabilityResponse());
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
      { kind: "http" as const, method: "POST", path: "/predict/archive-v2/conformal-presentation" },
      { kind: "http" as const, method: "POST", path: "/predict/archive-v2/conformal-projection" },
      { kind: "http" as const, method: "GET", path: "/workspaces/workspace-a/archive-v2" },
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
    expect(request).toHaveBeenCalledTimes(9);
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
    const request = vi.fn().mockImplementation(async () => capabilityResponse());
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

    await expect(preselectRendererTransport(
      { kind: "http", method: "POST", path: "/predict/archive-v2/conformal-presentation" },
      withoutPythonHost,
      request,
    )).resolves.toMatchObject({
      surface: "archive-v2-conformal-presentation",
      target: "native-sidecar",
      status: 200,
    });

    await expect(preselectRendererTransport(
      { kind: "http", method: "GET", path: "/workspaces/workspace-a/archive-v2" },
      withoutPythonHost,
      request,
    )).resolves.toMatchObject({
      surface: "archive-v2-catalogue",
      target: "native-sidecar",
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
      { kind: "http", method: "GET", path: "/datasets/detect-unified" },
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
