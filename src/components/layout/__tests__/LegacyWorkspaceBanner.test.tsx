/**
 * @vitest-environment jsdom
 */

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceTransitionStatus } from "@/api/workspace";
import type { WorkspaceTransitionStatusResponse } from "@/types/storage";
import { LegacyWorkspaceBanner } from "../LegacyWorkspaceBanner";

vi.mock("@/api/workspace", () => ({
  getWorkspaceTransitionStatus: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

function transitionStatus(
  overrides: Partial<WorkspaceTransitionStatusResponse> = {},
): WorkspaceTransitionStatusResponse {
  return {
    path: "/tmp/legacy",
    format: "duckdb-workspace",
    conversion_required: true,
    message:
      "Legacy DuckDB workspace detected. Convert it to the V1 workspace format before switching runtimes.",
    conversion_command: "nirs4all workspace convert /tmp/legacy",
    default_output_path: "/tmp/legacy-workspace-v2",
    converter_available: true,
    ...overrides,
  };
}

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });

  await act(async () => {
    root.render(<MemoryRouter>{element}</MemoryRouter>);
  });

  return container;
}

async function flushAsyncUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.clearAllMocks();
});

describe("LegacyWorkspaceBanner", () => {
  it("shows a workspace-open warning when conversion is required", async () => {
    vi.mocked(getWorkspaceTransitionStatus).mockResolvedValue(transitionStatus());

    const container = await render(<LegacyWorkspaceBanner />);
    await flushAsyncUi();

    expect(container.textContent).toContain("Legacy workspace format detected");
    expect(container.textContent).toContain("Legacy DuckDB workspace detected");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/settings?tab=workspaces");
  });

  it("stays hidden for V1 workspaces", async () => {
    vi.mocked(getWorkspaceTransitionStatus).mockResolvedValue(
      transitionStatus({
        conversion_required: false,
        format: "nirs4all-workspace-v2",
        message: "Workspace is already in the V1 format.",
      }),
    );

    const container = await render(<LegacyWorkspaceBanner />);
    await flushAsyncUi();

    expect(container.textContent).toBe("");
  });
});
