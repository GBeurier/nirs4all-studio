/**
 * Maps structured transport errors (`ApiError` from `@/api/transport`) to
 * plain-language, localized messages with an optional follow-up action.
 *
 * The transport keeps machine identifiers (`code`, `reason`); UI and toast
 * sites go through `describeApiError` so users never see them.
 */

import type { TFunction } from "i18next";
import { getApiErrorMessage } from "@/api/transport";

export interface UserFacingErrorAction {
  label: string;
  href: string;
}

export interface UserFacingError {
  message: string;
  action?: UserFacingErrorAction;
}

/** Settings tab that hosts the Python environment picker. */
const PYTHON_SETTINGS_HREF = "/settings?tab=advanced";

/** Refusal identifiers (renderer preselection reasons and sidecar error codes) that mean "no analysis engine". */
const ENGINE_UNAVAILABLE = new Set([
  "native_python_host_unavailable",
  "python_plugin_unavailable",
  "python_plugin_preflight_failed",
  "scientific_executor_unavailable",
]);

const NOT_AVAILABLE_YET = new Set([
  "route_not_native_qualified_rust_only",
  "native_route_contract_mismatch",
  "invalid_route_path",
  "route_not_found",
]);

const BACKEND_STARTING = new Set([
  "native_capability_preflight_refused",
  "native_sidecar_unavailable",
]);

function readStructuredFields(error: unknown): { code?: string; reason?: string; status?: number } {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
  };
}

/** Diagnostic text that is not meant to be read: raw JSON or machine tokens. */
function isMachineText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(trimmed);
}

export function describeApiError(error: unknown, t: TFunction, fallback?: string): UserFacingError {
  const { code, reason, status } = readStructuredFields(error);
  const identifiers = [reason, code].filter((value): value is string => Boolean(value));

  if (identifiers.some((id) => ENGINE_UNAVAILABLE.has(id))) {
    return {
      message: t("errors.api.engineUnavailable"),
      action: { label: t("errors.api.openPythonSettings"), href: PYTHON_SETTINGS_HREF },
    };
  }
  if (identifiers.some((id) => NOT_AVAILABLE_YET.has(id))) {
    return { message: t("errors.api.notAvailableYet") };
  }
  if (identifiers.some((id) => BACKEND_STARTING.has(id))) {
    return { message: t("errors.api.backendStarting") };
  }
  if (code === "request_timeout") return { message: t("errors.api.timeout") };
  if (code === "job_capacity_exceeded") return { message: t("errors.api.tooManyJobs") };
  if (code?.startsWith("STUDIO_")) return { message: t("errors.api.featureUnavailable") };
  if (status === 0) return { message: t("errors.api.backendUnreachable") };
  if (status === 503) return { message: t("errors.api.engineStarting") };

  const detail = getApiErrorMessage(error);
  if (detail && !isMachineText(detail)) return { message: detail };
  return { message: fallback ?? t("errors.generic") };
}
