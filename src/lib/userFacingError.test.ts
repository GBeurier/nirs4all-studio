import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";

import { describeApiError } from "./userFacingError";

const t = ((key: string) => key) as unknown as TFunction;

describe("describeApiError", () => {
  it("explains a missing Python host and links to the Python settings", () => {
    const result = describeApiError(
      { detail: "Renderer transport preselection rejected the request: native_python_host_unavailable", status: 503, code: "STUDIO_NATIVE_ROUTE_UNAVAILABLE", reason: "native_python_host_unavailable" },
      t,
    );
    expect(result.message).toBe("errors.api.engineUnavailable");
    expect(result.action).toEqual({ label: "errors.api.openPythonSettings", href: "/settings?tab=advanced" });
  });

  it("never exposes machine reasons for unmigrated routes", () => {
    const result = describeApiError(
      { detail: "rejected: route_not_native_qualified_rust_only", status: 501, code: "STUDIO_NATIVE_ROUTE_UNAVAILABLE", reason: "route_not_native_qualified_rust_only" },
      t,
    );
    expect(result).toEqual({ message: "errors.api.notAvailableYet" });
  });

  it("maps sidecar codes, startup statuses and unreachable backends", () => {
    expect(describeApiError({ detail: "x", status: 503, code: "python_plugin_unavailable" }, t).message).toBe("errors.api.engineUnavailable");
    expect(describeApiError({ detail: "x", status: 503, code: "request_timeout" }, t).message).toBe("errors.api.timeout");
    expect(describeApiError({ detail: "ML loading", status: 503 }, t).message).toBe("errors.api.engineStarting");
    expect(describeApiError({ detail: "Failed to fetch", status: 0 }, t).message).toBe("errors.api.backendUnreachable");
  });

  it("keeps human-readable backend messages and hides raw JSON or tokens", () => {
    expect(describeApiError({ detail: "Run deletion refused", status: 409 }, t).message).toBe("Run deletion refused");
    expect(describeApiError(new Error("Logs unavailable"), t).message).toBe("Logs unavailable");
    expect(describeApiError({ detail: '{"error":{"code":"x"}}', status: 500 }, t, "fallback").message).toBe("fallback");
    expect(describeApiError({ detail: "some_machine_token", status: 500 }, t).message).toBe("errors.generic");
  });
});
