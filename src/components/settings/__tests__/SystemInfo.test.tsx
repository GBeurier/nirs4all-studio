/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SystemInfo } from "../SystemInfo";

const mocks = vi.hoisted(() => ({ info: vi.fn(), capabilities: vi.fn(), runtime: vi.fn() }));
vi.mock("@/api/system", () => ({ getSystemInfo: mocks.info, getSystemCapabilities: mocks.capabilities, getRuntimeSummary: mocks.runtime }));
vi.mock("react-i18next", () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SystemInfo partial diagnostics", () => {
  it.each([false, true])("keeps OS information available when Python availability is %s", async (pythonAvailable) => {
    vi.resetAllMocks();
    mocks.info.mockResolvedValue({ python_available: pythonAvailable,
      python: { version: pythonAvailable ? "3.12.3" : "", platform: "win32", executable: "" },
      system: { os: "Windows", release: "11", machine: "AMD64", processor: "" },
      nirs4all_version: "", packages: {},
    });
    mocks.capabilities.mockRejectedValue({ status: 503, detail: "Scientific plugin unavailable" });
    mocks.runtime.mockRejectedValue({ status: 503, detail: "Python runtime unavailable" });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<SystemInfo />));
      expect(container.textContent).toContain("Windows 11");
      expect(container.textContent).toContain("AMD64");
      expect(container.textContent).toContain("settings.systemInfo.capabilitiesUnavailable");
      expect(container.textContent).not.toContain("common.retry");
      expect(mocks.capabilities).toHaveBeenCalledTimes(pythonAvailable ? 1 : 0);
    } finally { await act(async () => root.unmount()); }
  });
});
