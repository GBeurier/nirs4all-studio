/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { NativeResultsExportAffordance } from "./NativeResultsExportAffordance";
import { RuntimeDiagnosticsList } from "./RuntimeDiagnosticsList";
import { RuntimeEngineBadge } from "./RuntimeEngineBadge";
import { RuntimeRunStatePresentation } from "./RuntimeStatus";

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
