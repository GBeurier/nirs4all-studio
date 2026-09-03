/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeResultsExportAffordance } from "./NativeResultsExportAffordance";
import { RuntimeBackendStatus } from "./RuntimeBackendStatus";
import { RuntimeDiagnosticsList } from "./RuntimeDiagnosticsList";
import { RuntimeEngineBadge } from "./RuntimeEngineBadge";
import { RuntimeRunStatePresentation } from "./RuntimeStatus";

const mocks = vi.hoisted(() => ({
  getRuntimeSummary: vi.fn(),
}));

vi.mock("@/api/system", () => ({
  getRuntimeSummary: mocks.getRuntimeSummary,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
  mocks.getRuntimeSummary.mockReset();
});

describe("runtime result components", () => {
  it("renders engine, diagnostics, progress, and native export affordance", async () => {
    const source = {
      engine: "legacy",
      engine_requested: "dag-ml",
      engine_diagnostics: [{
        verb: "run",
        cause: "unsupported_shape",
        message: "dag-ml does not support this pipeline shape",
        mitigation: "Use legacy or simplify the pipeline.",
        unsupported_capability: "branch_execution",
      }],
    };

    const { container, root } = await render(
      <>
        <RuntimeEngineBadge source={source} />
        <RuntimeDiagnosticsList source={source} />
        <RuntimeRunStatePresentation status="running" progress={37} />
        <NativeResultsExportAffordance hasRefit nativeArtifactCount={1} />
      </>,
    );

    expect(container.textContent).toContain("Legacy fallback");
    expect(container.textContent).toContain("Runtime Diagnostics");
    expect(container.textContent).toContain("Unsupported Shape");
    expect(container.textContent).toContain("Missing capability: Branch Execution");
    expect(container.textContent).toContain("37%");
    expect(container.textContent).toContain("1 native artifact");
    expect(container.textContent).toContain("Export Final Model (.n4a)");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not render empty diagnostics", async () => {
    const { container, root } = await render(<RuntimeDiagnosticsList source={{ engine: "dag-ml" }} />);

    expect(container.textContent).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("disables native export when no native results are attached", async () => {
    const { container, root } = await render(
      <NativeResultsExportAffordance hasRefit={true} hasNativeResults={false} nativeArtifactCount={0} />,
    );

    expect(container.textContent).toContain("Native results not attached");
    expect(container.textContent).toContain("Native result artifacts are not attached for this run.");
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("RuntimeBackendStatus", () => {
  it("reports native unavailable without exposing a selector", async () => {
    mocks.getRuntimeSummary.mockResolvedValue({
      runtime_engine_capabilities: {
        supports_explicit_run_engine: false,
        supported_engines: [],
        default_engine: "legacy",
        reason: "unsupported",
      },
    });
    const { container, root } = await render(<RuntimeBackendStatus />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Native unavailable");
    expect(container.textContent).toContain("Legacy execution and fallback are disabled");
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("reports native available when strict DAG-ML is supported", async () => {
    mocks.getRuntimeSummary.mockResolvedValue({
      runtime_engine_capabilities: {
        supports_explicit_run_engine: true,
        supported_engines: ["legacy", "dag-ml"],
        default_engine: "legacy",
        reason: null,
      },
    });
    const { container, root } = await render(<RuntimeBackendStatus />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Native available");

    await act(async () => {
      root.unmount();
    });
  });
});
