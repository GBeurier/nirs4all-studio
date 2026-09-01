import { describe, expect, it, vi } from "vitest";

import {
  PYTHON_HTTP_DIAGNOSTIC_SWITCH,
  PythonHttpDiagnosticDisabledError,
  requirePythonHttpDiagnostic,
  resolvePythonHttpDiagnosticPolicy,
} from "./python-http-diagnostic-policy";

describe("Python HTTP diagnostic policy", () => {
  it("keeps packaged Studio Rust-only by default", () => {
    expect(resolvePythonHttpDiagnosticPolicy({
      isPackaged: true,
      hasSwitch: vi.fn().mockReturnValue(false),
      environmentValue: undefined,
    })).toEqual({
      enabled: false,
      mode: "rust-only",
      source: "default",
      reason: "python_http_disabled_by_default",
    });
  });

  it("does not let a packaged process inherit diagnostic HTTP from the environment", () => {
    expect(resolvePythonHttpDiagnosticPolicy({
      isPackaged: true,
      hasSwitch: vi.fn().mockReturnValue(false),
      environmentValue: "1",
    }).enabled).toBe(false);
  });

  it("allows the visible explicit CLI diagnostic switch in a packaged build", () => {
    const hasSwitch = vi.fn((name: string) =>
      name === PYTHON_HTTP_DIAGNOSTIC_SWITCH);
    expect(resolvePythonHttpDiagnosticPolicy({
      isPackaged: true,
      hasSwitch,
    })).toMatchObject({
      enabled: true,
      mode: "python-http-diagnostic",
      source: "explicit-cli",
    });
  });

  it("allows an exact opt-in environment value only during development", () => {
    expect(resolvePythonHttpDiagnosticPolicy({
      isPackaged: false,
      hasSwitch: vi.fn().mockReturnValue(false),
      environmentValue: "1",
    })).toMatchObject({ enabled: true, source: "explicit-dev-env" });
    expect(resolvePythonHttpDiagnosticPolicy({
      isPackaged: false,
      hasSwitch: vi.fn().mockReturnValue(false),
      environmentValue: "true",
    }).enabled).toBe(false);
  });

  it("raises a typed refusal before a default session can acquire Python HTTP", () => {
    const policy = resolvePythonHttpDiagnosticPolicy({
      isPackaged: true,
      hasSwitch: vi.fn().mockReturnValue(false),
    });

    expect(() => requirePythonHttpDiagnostic(policy)).toThrow(
      PythonHttpDiagnosticDisabledError,
    );
    try {
      requirePythonHttpDiagnostic(policy);
    } catch (error) {
      expect(error).toMatchObject({
        code: "STUDIO_PYTHON_HTTP_DIAGNOSTIC_DISABLED",
        status: 501,
      });
    }
  });
});
