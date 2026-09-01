export type WorkspaceRunDetailTarget =
  | "native-sidecar"
  | "scientific-plugin"
  | "reject";

export interface WorkspaceRunDetailPreselection {
  schema_id: "nirs4all.studio-run-detail-preselection-decision.v1";
  workspace_id: string;
  target: WorkspaceRunDetailTarget;
  verified_store_v5: boolean;
  store_schema_version: 5 | null;
  reason: string;
  fallback_after_native_selection: "none";
  status: number;
}

interface NativeSidecarRouteInfo {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  url: string | null;
}

const DECISION_SCHEMA =
  "nirs4all.studio-run-detail-preselection-decision.v1" as const;

function scientificPluginDecision(
  workspaceId: string,
  reason: string,
): WorkspaceRunDetailPreselection {
  return {
    schema_id: DECISION_SCHEMA,
    workspace_id: workspaceId,
    target: "scientific-plugin",
    verified_store_v5: false,
    store_schema_version: null,
    reason,
    fallback_after_native_selection: "none",
    status: 200,
  };
}

function isDecision(value: unknown): value is Omit<WorkspaceRunDetailPreselection, "status"> {
  if (!value || typeof value !== "object") return false;
  const decision = value as Record<string, unknown>;
  const target = decision.target;
  return (
    decision.schema_id === DECISION_SCHEMA &&
    typeof decision.workspace_id === "string" &&
    (target === "native-sidecar" ||
      target === "scientific-plugin" ||
      target === "reject") &&
    typeof decision.verified_store_v5 === "boolean" &&
    (decision.store_schema_version === 5 ||
      decision.store_schema_version === null) &&
    typeof decision.reason === "string" &&
    decision.fallback_after_native_selection === "none" &&
    (target !== "native-sidecar" ||
      (decision.verified_store_v5 === true &&
        decision.store_schema_version === 5)) &&
    (target !== "scientific-plugin" || decision.verified_store_v5 === false) &&
    (decision.verified_store_v5 === false || decision.store_schema_version === 5)
  );
}

/**
 * Resolve one run-detail target without activating the scientific plugin.
 * The sidecar's Rust reader owns ID→path resolution and exact Store-v5
 * verification and exact owner-callable preflight. This function does not
 * cache the decision or expose the resolved filesystem path. Exact Store v5
 * selects the native target only when the bounded CPython library host is
 * configured and ready; legacy storage selects the scientific plugin before
 * the target request.
 */
export async function preselectWorkspaceRunDetail(
  workspaceId: string,
  sidecarInfo: () => NativeSidecarRouteInfo,
  request: typeof fetch = fetch,
): Promise<WorkspaceRunDetailPreselection> {
  if (!workspaceId || workspaceId.trim() !== workspaceId) {
    return {
      ...scientificPluginDecision(workspaceId, "invalid_workspace_id"),
      target: "reject",
      status: 400,
    };
  }

  const info = sidecarInfo();
  if (info.status !== "running" || !info.url) {
    return scientificPluginDecision(workspaceId, "native_sidecar_unavailable");
  }

  try {
    const response = await request(
      `${info.url}/sidecar/v1/workspaces/${encodeURIComponent(workspaceId)}/run-detail-preselection`,
      { method: "GET" },
    );
    const body: unknown = await response.json();
    const statusMatchesTarget = isDecision(body) &&
      (body.target === "reject" ? !response.ok : response.ok);
    if (!isDecision(body) || body.workspace_id !== workspaceId || !statusMatchesTarget) {
      return {
        ...scientificPluginDecision(workspaceId, "invalid_native_preselection_response"),
        target: "reject",
        status: 500,
      };
    }
    return { ...body, status: response.status };
  } catch {
    return {
      ...scientificPluginDecision(workspaceId, "native_preselection_unreachable"),
      target: "reject",
      status: 503,
    };
  }
}
