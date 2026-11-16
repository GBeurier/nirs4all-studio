/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PythonEnvProvider } from "./PythonEnvContext";
import { usePythonEnv, type PythonEnvContextValue } from "./usePythonEnv";
import {
  envState,
  installPythonEnvApi,
  mockPythonEnvApi,
  unconfiguredState,
} from "@/components/python-env/__tests__/fixtures";

const mocks = vi.hoisted(() => ({ resetBackendUrl: vi.fn() }));
vi.mock("@/api/transport", () => ({ resetBackendUrl: mocks.resetBackendUrl }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PythonEnvProvider", () => {
  let root: Root;
  let seen: PythonEnvContextValue;
  let restoreApi: (() => void) | undefined;

  function Probe() {
    seen = usePythonEnv();
    return null;
  }
  async function mount() {
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<PythonEnvProvider><Probe /></PythonEnvProvider>));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    restoreApi?.();
    restoreApi = undefined;
  });

  it("mirrors the state of the main process and follows its updates", async () => {
    const api = mockPythonEnvApi(unconfiguredState());
    restoreApi = installPythonEnvApi(api);
    await mount();
    expect(seen.state?.phase).toBe("unconfigured");

    await act(async () => api.emit(envState()));
    expect(seen.state?.phase).toBe("ready");
  });

  it("adopts the state of an action and announces the restarted backend only on success", async () => {
    const api = mockPythonEnvApi(unconfiguredState());
    api.retry.mockResolvedValueOnce({ success: false, message: "offline", state: unconfiguredState() })
      .mockResolvedValue({ success: true, state: envState() });
    restoreApi = installPythonEnvApi(api);
    const restarted = vi.fn();
    window.addEventListener("backend-restarted", restarted);
    try {
      await mount();
      await act(async () => { await seen.run((env) => env.retry()); });
      expect(restarted).not.toHaveBeenCalled();
      expect(seen.state?.phase).toBe("unconfigured");

      await act(async () => { await seen.run((env) => env.retry()); });
      expect(seen.state?.phase).toBe("ready");
      expect(restarted).toHaveBeenCalledTimes(1);
      expect(mocks.resetBackendUrl).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("backend-restarted", restarted);
    }
  });

  it("remembers the choice to continue without Python across a window reload", async () => {
    restoreApi = installPythonEnvApi(mockPythonEnvApi(unconfiguredState()));
    await mount();
    expect(seen.setupSkipped).toBe(false);
    await act(async () => seen.skipSetup());
    expect(seen.setupSkipped).toBe(true);

    // A reload keeps the session storage and rebuilds the provider.
    await act(async () => root.unmount());
    await mount();
    expect(seen.setupSkipped).toBe(true);
  });

  it("exposes no environment management outside the desktop application", async () => {
    await mount();
    expect(seen.api).toBeNull();
    expect(seen.state).toBeNull();
  });
});
