/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigAlignment } from "../ConfigAlignment";

const mocks = vi.hoisted(() => ({ diff: vi.fn(), align: vi.fn(), build: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useRecommendedConfig", () => ({
  useConfigDiff: mocks.diff,
  useRecommendedConfig: () => ({ data: null }),
  useAlignConfig: () => ({ mutate: mocks.align, isPending: false }),
}));
vi.mock("@/api/system", () => ({ getBuildInfo: mocks.build }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConfigAlignment runtime capabilities", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.build.mockResolvedValue({ runtime_mode: "development" });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); });
  async function mount(available?: boolean) {
    mocks.diff.mockReturnValue({ data: {
      profile: "cpu", packages: [], is_aligned: false, misaligned_count: 0, missing_count: 1,
      package_management_available: available,
    }, isLoading: false, refetch: vi.fn() });
    await act(async () => root.render(<ConfigAlignment />));
  }
  it("does not offer an unsupported alignment for the native runtime", async () => {
    await mount(false);
    expect(container.textContent).not.toContain("settings.configAlignment.alignAll");
    expect(container.textContent).toContain("Install an updated Studio release");
  });
  it("retains alignment for the writable web backend", async () => {
    await mount();
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("settings.configAlignment.alignAll"));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(mocks.align).toHaveBeenCalledWith({ profile: "cpu" }, expect.any(Object));
  });
});
