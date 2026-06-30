/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeInfo } from "@/api/updates";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";

import { RuntimeStatusPanel } from "../UpdatesSectionRuntimePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

const runtime: RuntimeInfo = {
  created_at: null,
  exists: true,
  is_valid: true,
  last_updated: null,
  path: "/opt/nirs4all/runtime",
  pip_version: "24.0",
  python_executable: "/opt/nirs4all/runtime/bin/python",
  python_version: "3.11.9",
  size_bytes: 1024,
};

const runtimeDisplay: PythonRuntimeDisplayState = {
  isBundledEmbedded: false,
  isBundledExternal: false,
  isPyInstaller: false,
  isReadOnly: false,
  label: "Current runtime",
  runtimeKind: "managed",
};

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });

  await act(async () => {
    root.render(element);
  });

  return container;
}

async function click(button: HTMLButtonElement | null) {
  expect(button).not.toBeNull();

  await act(async () => {
    button?.click();
  });
}

function panel(overrides: Partial<Parameters<typeof RuntimeStatusPanel>[0]> = {}) {
  return (
    <RuntimeStatusPanel
      currentRuntime={runtime}
      gpuDisplay={{ label: "RTX 4090 (CUDA 12.4)", muted: false }}
      isLoading={false}
      onOpenChange={vi.fn()}
      open
      packageCount={3}
      runtimeDisplay={runtimeDisplay}
      runtimeExecutablePath="/running/python"
      runtimeSizeLabel="1 KB"
      torchDisplay={{ label: "2.7.0 (CUDA ready)", muted: false }}
      {...overrides}
    />
  );
}

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.clearAllMocks();
});

describe("RuntimeStatusPanel", () => {
  it("renders the prepared valid runtime, GPU, and Torch details", async () => {
    const container = await render(panel());

    expect(container.textContent).toContain("Current Python Runtime");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Current runtime");
    expect(container.textContent).toContain("3.11.9");
    expect(container.textContent).toContain("/running/python");
    expect(container.textContent).toContain("RTX 4090 (CUDA 12.4)");
    expect(container.textContent).toContain("2.7.0 (CUDA ready)");
    expect(container.textContent).toContain("1 KB");
    expect(container.textContent).toContain("3 installed");
    expect(container.textContent).toContain("/opt/nirs4all/runtime");
  });

  it("renders the invalid runtime warning when the current runtime is unavailable", async () => {
    const container = await render(panel({
      currentRuntime: {
        ...runtime,
        is_valid: false,
      },
      torchDisplay: null,
    }));

    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).toContain("The current Python runtime is not valid.");
    expect(container.textContent).not.toContain("3 installed");
  });

  it("delegates collapsible state changes to the parent", async () => {
    const onOpenChange = vi.fn();
    const container = await render(panel({
      onOpenChange,
      open: false,
    }));

    await click(container.querySelector("button"));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
