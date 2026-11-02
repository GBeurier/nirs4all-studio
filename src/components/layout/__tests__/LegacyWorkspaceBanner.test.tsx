/**
 * @vitest-environment jsdom
 */

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceFormatStatus } from "@/api/workspace";
import { clientStorageKeys, readClientStorageJson } from "@/lib/clientStorage";
import { LegacyWorkspaceBanner } from "../LegacyWorkspaceBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/workspace", () => ({
  getWorkspaceFormatStatus: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

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
  localStorage.clear();
});

describe("LegacyWorkspaceBanner", () => {
  it("points to nirs4all-tools once for a DuckDB workspace", async () => {
    vi.mocked(getWorkspaceFormatStatus).mockResolvedValue({ path: "/tmp/legacy", legacy_duckdb: true });

    const container = await render(<LegacyWorkspaceBanner />);
    await flushAsyncUi();

    expect(container.textContent).toContain("layout.legacyWorkspace.title");
    expect(container.textContent).toContain("nirs4all-tools workspace convert");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://github.com/GBeurier/nirs4all-tools");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[aria-label='layout.legacyWorkspace.dismiss']")?.click();
    });
    expect(container.textContent).toBe("");
    expect(readClientStorageJson(clientStorageKeys.dismissedLegacyWorkspaceNotices)).toEqual(["/tmp/legacy"]);

    const again = await render(<LegacyWorkspaceBanner />);
    await flushAsyncUi();
    expect(again.textContent).toBe("");
  });

  it("stays hidden for V1 workspaces", async () => {
    vi.mocked(getWorkspaceFormatStatus).mockResolvedValue({ path: "/tmp/v1", legacy_duckdb: false });

    const container = await render(<LegacyWorkspaceBanner />);
    await flushAsyncUi();

    expect(container.textContent).toBe("");
  });
});
