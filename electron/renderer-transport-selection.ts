export type RendererTransportRequest =
  | { kind: "http"; method: string; path: string }
  | { kind: "websocket"; path: string };

export type RendererTransportTarget =
  | "native-sidecar"
  | "reject";

export interface RendererTransportSelection {
  schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1";
  kind: "http" | "websocket";
  method: string | null;
  path: string;
  surface: string;
  target: RendererTransportTarget;
  base_url: string | null;
  renderer_transport: boolean;
  scientific_execution: false;
  reason: string;
  fallback_after_native_selection: "none";
  status: number;
}

interface NativeSidecarRouteInfo {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  url: string | null;
  pythonPluginHostConfigured?: boolean;
}

interface NativeSurface {
  name: string;
  capability: string;
  requiresPythonHost?: boolean;
}

const DECISION_SCHEMA =
  "nirs4all.studio-renderer-transport-selection-decision.v1" as const;
const PROTOCOL_VERSION = "studio-sidecar-r1";
const IDENTIFIER = "[A-Za-z0-9._-]{1,256}";
const identifierPath = (prefix: string, suffix = "") =>
  new RegExp(`^${prefix}(${IDENTIFIER})${suffix}$`);
const exactHttpRoutes = new Map<string, NativeSurface>([
  ["GET /health", { name: "health", capability: "health" }],
  ["GET /system/readiness", { name: "readiness", capability: "readiness" }],
  ["GET /system/status", { name: "system-status", capability: "system_status_route" }],
  ["GET /app/settings", { name: "app-settings", capability: "app_settings_routes" }],
  ["PUT /app/settings", { name: "app-settings", capability: "app_settings_routes" }],
  ["GET /app/favorites", { name: "app-favorites", capability: "app_settings_routes" }],
  ["POST /app/favorites", { name: "app-favorites", capability: "app_settings_routes" }],
  ["GET /app/config-path", { name: "app-config-path", capability: "app_config_path_routes" }],
  ["POST /app/config-path", { name: "app-config-path", capability: "app_config_path_routes" }],
  ["DELETE /app/config-path", { name: "app-config-path", capability: "app_config_path_routes" }],
  ["GET /workspaces", { name: "linked-workspaces", capability: "linked_workspace_catalog_route" }],
  ["GET /workspace", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["POST /workspace/create", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["POST /workspace/select", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["POST /workspace/reload", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["GET /workspace/list", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["GET /workspace/groups", { name: "workspace-documents", capability: "workspace_document_routes" }],
  ["GET /pipelines", { name: "pipeline-documents", capability: "pipeline_document_routes" }],
  ["POST /pipelines", { name: "pipeline-documents", capability: "pipeline_document_routes" }],
  ["POST /pipelines/import-preview", { name: "pipeline-library", capability: "pipeline_library_routes", requiresPythonHost: true }],
  ["POST /pipelines/import", { name: "pipeline-library", capability: "pipeline_library_routes", requiresPythonHost: true }],
  ["POST /pipelines/render-canonical", { name: "pipeline-library", capability: "pipeline_library_routes", requiresPythonHost: true }],
  ["GET /datasets", { name: "dataset-catalogue", capability: "dataset_catalogue_routes" }],
  ["POST /datasets/link", { name: "dataset-catalogue", capability: "dataset_catalogue_routes" }],
  ["GET /config/setup-status", { name: "setup", capability: "app_settings_routes" }],
  ["POST /config/skip-setup", { name: "setup", capability: "app_settings_routes" }],
  ["POST /config/complete-setup", { name: "setup", capability: "app_settings_routes" }],
  ["GET /workspace/transition-status", { name: "workspace-transition-status", capability: "workspace_transition_status_route" }],
  ["POST /workspace/legacy-convert", { name: "legacy-workspace-conversion", capability: "legacy_workspace_conversion_route", requiresPythonHost: true }],
  ["GET /system/network", { name: "system-network", capability: "system_network_route" }],
  ["GET /updates/settings", { name: "updates-settings", capability: "updates_settings_routes" }],
  ["PUT /updates/settings", { name: "updates-settings", capability: "updates_settings_routes" }],
  ["POST /runs/run-groups", { name: "scientific-submission", capability: "scientific_submission_transport" }],
  ["POST /predict/archive-v2", { name: "archive-v2-prediction", capability: "native_archive_v2_prediction" }],
  ["POST /predict/archive-v2/conformal-presentation", { name: "archive-v2-conformal-presentation", capability: "native_conformal_presentation_v2" }],
  ["POST /predict/archive-v2/conformal-projection", { name: "archive-v2-conformal-projection", capability: "native_conformal_presentation_v2" }],
]);

const pythonHostRoutes = new Map<string, NativeSurface>([
  ["GET /system/capabilities", { name: "system-capabilities", capability: "system_capabilities_route", requiresPythonHost: true }],
  ["GET /system/info", { name: "system-info", capability: "system_info_route", requiresPythonHost: true }],
  ["GET /system/build", { name: "system-build", capability: "system_build_route", requiresPythonHost: true }],
  ["GET /system/env-coherence", { name: "system-env-coherence", capability: "system_env_coherence_route", requiresPythonHost: true }],
  ["GET /updates/version", { name: "updates-version", capability: "updates_version_route", requiresPythonHost: true }],
  ["GET /updates/runtime/status", { name: "updates-runtime-status", capability: "updates_runtime_status_route", requiresPythonHost: true }],
]);

function isValidIdentifier(value: string): boolean {
  return value !== "." && value !== ".." && new RegExp(`^${IDENTIFIER}$`).test(value);
}

function classifyWorkspaceRuns(path: string): NativeSurface | null {
  const [pathname, query] = path.split("?", 2);
  if (!identifierPath("/workspaces/", "/runs").test(pathname)) return null;
  if (query === undefined) {
    return { name: "workspace-run-summaries", capability: "workspace_store_v5_run_summary_route" };
  }
  if (!query) return null;
  const seen = new Set<string>();
  for (const part of query.split("&")) {
    const pieces = part.split("=");
    if (pieces.length !== 2 || seen.has(pieces[0])) return null;
    const [name, value] = pieces;
    if (name === "source" && ["unified", "manifests", "parquet"].includes(value)) {
      seen.add(name);
    } else if (name === "refresh" && ["true", "false"].includes(value)) {
      seen.add(name);
    } else {
      return null;
    }
  }
  return { name: "workspace-run-summaries", capability: "workspace_store_v5_run_summary_route" };
}

function classifyHttp(method: string, path: string): NativeSurface | null {
  const exact = exactHttpRoutes.get(`${method} ${path}`) ?? pythonHostRoutes.get(`${method} ${path}`);
  if (exact) return exact;
  const workflow = classifyScientificWorkflow(method, path);
  if (workflow) return workflow;
  const dataset = identifierPath("/datasets/").exec(path);
  if (["GET", "PUT", "DELETE"].includes(method) && dataset && isValidIdentifier(dataset[1]) &&
      !["link", "preview", "detect-unified", "detect-files", "detect-format", "detect-files-list", "scan-folder", "auto-detect", "validate-files"].includes(dataset[1])) {
    return { name: "dataset-catalogue", capability: "dataset_catalogue_routes" };
  }
  const pipeline = identifierPath("/pipelines/").exec(path);
  if (["GET", "PUT", "DELETE"].includes(method) && pipeline &&
      isValidIdentifier(pipeline[1]) &&
      !["presets", "samples", "import", "import-preview", "render-canonical", "propagate-shape"].includes(pipeline[1])) {
    return { name: "pipeline-documents", capability: "pipeline_document_routes" };
  }
  if (method === "DELETE" && identifierPath("/app/favorites/").test(path)) {
    return { name: "app-favorites", capability: "app_settings_routes" };
  }
  if (method === "DELETE" && identifierPath("/workspaces/").test(path)) {
    return { name: "linked-workspace-state", capability: "linked_workspace_state_routes" };
  }
  if (method === "POST" && identifierPath("/workspaces/", "/activate").test(path)) {
    return { name: "linked-workspace-state", capability: "linked_workspace_state_routes" };
  }
  if (method === "GET") {
    if (identifierPath("/workspaces/", "/archive-v2").test(path)) {
      return { name: "archive-v2-catalogue", capability: "native_archive_v2_prediction" };
    }
    const runs = classifyWorkspaceRuns(path);
    if (runs) return runs;
    if (identifierPath("/workspaces/", "/results").test(path)) {
      return { name: "workspace-pipeline-summaries", capability: "workspace_store_v5_pipeline_summary_route" };
    }
    if (identifierPath("/workspaces/", "/results/summary").test(path)) {
      return { name: "workspace-results-summary", capability: "workspace_store_v5_results_summary_route" };
    }
    if (identifierPath("/training/").test(path) && !path.endsWith("/start") && !path.endsWith("/jobs")) {
      return { name: "job-status", capability: "native_job_status_routes" };
    }
    if (identifierPath("/automl/").test(path) && !path.endsWith("/jobs")) {
      return { name: "job-status", capability: "native_job_status_routes" };
    }
    if (identifierPath("/updates/webapp/download-status/").test(path)) {
      return { name: "job-status", capability: "native_job_status_routes" };
    }
    if (identifierPath("/runs/execution-job-records/").test(path) || identifierPath("/runs/", "/execution-job-record").test(path)) {
      return { name: "durable-job-record", capability: "durable_execution_job_record_reads" };
    }
  }
  if (method === "POST") {
    if (
      identifierPath("/training/", "/stop").test(path) ||
      identifierPath("/automl/", "/stop").test(path) ||
      identifierPath("/runs/execution-job-records/", "/cancel").test(path) ||
      identifierPath("/runs/", "/stop").test(path) ||
      identifierPath("/updates/webapp/download-cancel/").test(path)
    ) {
      return { name: "job-cancellation", capability: "native_job_cancellation_routes" };
    }
  }
  return null;
}

/** Only implemented Rust routes; body/config authorization remains with Rust. */
function classifyScientificWorkflow(method: string, path: string): NativeSurface | null {
  const [pathname, query] = path.split("?", 2);
  const fields = new URLSearchParams(query);
  if (path.split("?").length > 2 || (query !== undefined && !query) ||
      [...fields.keys()].some((key) => fields.getAll(key).length !== 1)) return null;
  const bool = (value: string) => value === "true" || value === "false";
  const validQuery = (allowed: Record<string, (value: string) => boolean>) =>
    [...fields].every(([key, value]) => allowed[key]?.(value) === true);
  if (method === "GET" && ((pathname === "/runs/stats" && !query) || (pathname === "/runs" && validQuery({
    status: (value) => value.split(",").every((status) => ["running", "queued", "completed", "failed", "cancelled", "partial"].includes(status)),
  })))) return { name: "run-listing", capability: "workspace_run_listing_routes" };
  const history = identifierPath("/workspaces/", "/runs/enriched").exec(pathname);
  if (method === "GET" && history && isValidIdentifier(history[1]) && validQuery({
    project_id: isValidIdentifier, limit: (value) => /^\d+$/.test(value), offset: (value) => /^\d+$/.test(value),
  })) return { name: "run-history", capability: "workspace_run_history_route" };
  if (!query && ((method === "GET" && pathname === "/models/available") ||
      (method === "POST" && ["/predict", "/predict/file"].includes(pathname)))) {
    return { name: "general-prediction", capability: "general_prediction_routes", requiresPythonHost: true };
  }
  if (method === "GET" && pathname === "/config/recommended" && validQuery({ force_refresh: bool })) {
    return { name: "recommended-config", capability: "recommended_config_routes" };
  }
  if (method === "GET" && ((pathname === "/config/detect-gpu" && !query) ||
      (pathname === "/config/diff" && validQuery({ profile: isValidIdentifier, include_optional: bool, include_latest: bool })))) {
    return { name: "runtime-config", capability: "recommended_config_routes", requiresPythonHost: true };
  }
  const inspection = ["detect-files", "detect-unified", "detect-files-list", "scan-folder", "detect-format", "auto-detect", "validate-files", "preview"];
  if (method === "POST" && !query && inspection.some((operation) => pathname === `/datasets/${operation}`)) {
    return { name: "dataset-inspection", capability: "dataset_inspection_routes" };
  }
  const dataset = identifierPath("/datasets/", "/(preview|stats)").exec(pathname);
  if (method === "GET" && dataset && isValidIdentifier(dataset[1]) && validQuery(dataset[2] === "preview"
    ? { max_samples: (value) => /^\d+$/.test(value) }
    : { partition: (value) => ["train", "test", "all"].includes(value) })) {
    return { name: "dataset-inspection", capability: "dataset_inspection_routes", requiresPythonHost: true };
  }
  return null;
}

function classifyWebSocket(path: string): NativeSurface | null {
  const job = /^\/ws\/(job|training)\/([^/?]+)$/.exec(path);
  if (!job || !isValidIdentifier(job[2])) return null;
  return { name: `job-${job[1]}-websocket`, capability: "renderer_websocket_transport" };
}

function isNativeShapedCandidate(request: RendererTransportRequest): boolean {
  if (request.kind === "websocket") {
    return request.path.startsWith("/ws/job/") ||
      request.path.startsWith("/ws/training/");
  }
  const pathname = request.path.split("?", 1)[0];
  if (
    [...exactHttpRoutes.keys(), ...pythonHostRoutes.keys()]
      .some((entry) => entry.slice(entry.indexOf(" ") + 1) === pathname)
  ) return true;
  return /^\/app\/favorites\/[^/]*$/.test(pathname) ||
    /^\/workspaces\/[^/]+\/(?:activate|archive-v2|runs|results(?:\/summary)?)\/?$/.test(pathname) ||
    /^\/training\/(?!start$|jobs$)[^/]+(?:\/stop)?$/.test(pathname) ||
    /^\/automl\/(?!jobs$)[^/]+(?:\/stop)?$/.test(pathname) ||
    /^\/updates\/webapp\/(?:download-status|download-cancel)\/[^/]*$/.test(pathname) ||
    /^\/runs\/run-groups\/?$/.test(pathname) ||
    /^\/runs\/execution-job-records\/[^/]+(?:\/cancel)?$/.test(pathname) ||
    /^\/runs\/[^/]+\/(?:execution-job-record|stop)$/.test(pathname);
}

function decision(
  request: RendererTransportRequest,
  surface: string,
  target: RendererTransportTarget,
  reason: string,
  status: number,
  baseUrl: string | null = null,
): RendererTransportSelection {
  return {
    schema_id: DECISION_SCHEMA,
    kind: request.kind,
    method: request.kind === "http" ? request.method.toUpperCase() : null,
    path: request.path,
    surface,
    target,
    base_url: baseUrl,
    renderer_transport: target === "native-sidecar",
    scientific_execution: false,
    reason,
    fallback_after_native_selection: "none",
    status,
  };
}

function normalizeRequest(value: unknown): RendererTransportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (record.kind === "http") {
    if (keys !== "kind,method,path" || typeof record.method !== "string" || typeof record.path !== "string") return null;
    const method = record.method.toUpperCase();
    if (!/^[A-Z]{3,7}$/.test(method)) return null;
    return { kind: "http", method, path: record.path };
  }
  if (record.kind === "websocket") {
    if (keys !== "kind,path" || typeof record.path !== "string") return null;
    return { kind: "websocket", path: record.path };
  }
  return null;
}

export async function preselectRendererTransport(
  rawRequest: unknown,
  sidecarInfo: () => NativeSidecarRouteInfo,
  request: typeof fetch = fetch,
): Promise<RendererTransportSelection> {
  const normalized = normalizeRequest(rawRequest);
  if (!normalized) {
    const placeholder: RendererTransportRequest = { kind: "http", method: "GET", path: "" };
    return decision(placeholder, "invalid", "reject", "invalid_selection_request", 400);
  }
  if (!normalized.path.startsWith("/") || normalized.path.includes("#") || normalized.path.length > 2048) {
    return decision(normalized, "invalid", "reject", "invalid_route_path", 400);
  }

  const surface = normalized.kind === "http"
    ? classifyHttp(normalized.method, normalized.path)
    : classifyWebSocket(normalized.path);
  if (!surface) {
    if (isNativeShapedCandidate(normalized)) {
      return decision(normalized, "invalid-native-candidate", "reject", "native_route_contract_mismatch", 400);
    }
    return decision(
      normalized,
      "unmigrated",
      "reject",
      "route_not_native_qualified_rust_only",
      501,
    );
  }

  const info = sidecarInfo();
  if (info.status !== "running" || !info.url) {
    return decision(normalized, surface.name, "reject", "native_sidecar_unavailable", 503);
  }
  if (surface.requiresPythonHost && !info.pythonPluginHostConfigured) {
    return decision(normalized, surface.name, "reject", "native_python_host_unavailable", 503);
  }

  try {
    const response = await request(`${info.url}/sidecar/v1/capabilities`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return decision(normalized, surface.name, "reject", "native_capability_preflight_refused", 503);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      return decision(normalized, surface.name, "reject", "invalid_native_capabilities", 500);
    }
    const capabilities = body as Record<string, unknown>;
    const features = capabilities.features;
    if (
      capabilities.protocol_version !== PROTOCOL_VERSION ||
      !features || typeof features !== "object" || Array.isArray(features)
    ) {
      return decision(normalized, surface.name, "reject", "native_capability_mismatch", 503);
    }
    const nativeFeatures = features as Record<string, unknown>;
    // This capability becomes true when Rust has selected a bounded scientific
    // executor (including packaged CPython over stdio). It is not a renderer
    // route owner: validate the shape, while the transport and owner fields
    // below remain the fail-closed selection inputs.
    if (
      nativeFeatures.renderer_transport_selection !== true ||
      nativeFeatures.renderer_rust_only_default !== true ||
      nativeFeatures.implicit_python_http_fallback !== false ||
      nativeFeatures.unmigrated_renderer_routes_fail_closed !== true ||
      nativeFeatures[
        normalized.kind === "http"
          ? "renderer_http_transport"
          : "renderer_websocket_transport"
      ] !== true ||
      nativeFeatures[surface.capability] !== true ||
      (surface.requiresPythonHost &&
        nativeFeatures.python_plugin_preflight !== true) ||
      typeof nativeFeatures.scientific_execution !== "boolean"
    ) {
      return decision(normalized, surface.name, "reject", "native_capability_mismatch", 503);
    }
    return decision(normalized, surface.name, "native-sidecar", "native_capability_preflight_passed", 200, info.url);
  } catch {
    return decision(normalized, surface.name, "reject", "native_capability_preflight_unreachable", 503);
  }
}
