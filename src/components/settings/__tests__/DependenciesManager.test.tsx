/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import { getPythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import type { RuntimeSummaryResponse } from "@/types/settings";

function buildRuntimeSummary(
  overrides: Partial<RuntimeSummaryResponse> = {},
): RuntimeSummaryResponse {
  return {
    coherent: true,
    configured_python: "/configured/python",
    running_python: "/configured/python",
    running_prefix: "/configured",
    runtime_kind: "managed",
    is_bundled_default: false,
    bundled_runtime_available: false,
    configured_matches_running: true,
    core_ready: true,
    missing_core_packages: [],
    missing_optional_packages: [],
    python_match: true,
    prefix_match: true,
    runtime: {
      python: "/configured/python",
      prefix: "/configured",
      version: "3.11.9",
    },
    venv_manager: {
      python: "/configured/python",
      prefix: "/configured",
    },
    ...overrides,
  };
}

function areMutationButtonsDisabled(summary: RuntimeSummaryResponse | null): boolean {
  return getPythonRuntimeDisplayState(summary).isReadOnly;
}

describe("DependenciesManager runtime display rules", () => {
  it("treats the bundled embedded runtime as read-only", () => {
    const summary = buildRuntimeSummary({
      runtime_kind: "bundled",
      is_bundled_default: true,
      bundled_runtime_available: true,
    });

    const display = getPythonRuntimeDisplayState(summary);

    expect(display.label).toBe("Bundled embedded runtime");
    expect(display.isBundledEmbedded).toBe(true);
    expect(display.isBundledExternal).toBe(false);
    expect(areMutationButtonsDisabled(summary)).toBe(true);
  });

  it("treats a bundled build running on an external runtime as writable", () => {
    const summary = buildRuntimeSummary({
      runtime_kind: "custom",
      is_bundled_default: false,
      bundled_runtime_available: true,
      running_python: "/external/python",
      running_prefix: "/external",
      runtime: {
        python: "/external/python",
        prefix: "/external",
        version: "3.11.9",
      },
      venv_manager: {
        python: "/external/python",
        prefix: "/external",
      },
    });

    const display = getPythonRuntimeDisplayState(summary);

    expect(display.label).toBe("External user-selected runtime");
    expect(display.isBundledEmbedded).toBe(false);
    expect(display.isBundledExternal).toBe(true);
    expect(areMutationButtonsDisabled(summary)).toBe(false);
  });

  it("keeps a normal custom runtime writable even when configured and running differ", () => {
    const summary = buildRuntimeSummary({
      runtime_kind: "custom",
      configured_matches_running: false,
      coherent: false,
      configured_python: "/configured/python",
      running_python: "/running/python",
      running_prefix: "/running",
      runtime: {
        python: "/running/python",
        prefix: "/running",
        version: "3.11.9",
      },
      venv_manager: {
        python: "/running/python",
        prefix: "/running",
      },
    });

    const display = getPythonRuntimeDisplayState(summary);

    expect(display.label).toBe("User-selected runtime");
    expect(display.isReadOnly).toBe(false);
    expect(summary.configured_matches_running).toBe(false);
  });

  it("treats the legacy packaged backend runtime as read-only", () => {
    const summary = buildRuntimeSummary({
      runtime_kind: "pyinstaller",
    });

    const display = getPythonRuntimeDisplayState(summary);

    expect(display.label).toBe("Packaged backend runtime");
    expect(display.isPyInstaller).toBe(true);
    expect(areMutationButtonsDisabled(summary)).toBe(true);
  });
});
