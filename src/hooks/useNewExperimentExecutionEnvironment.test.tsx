/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRunExecutionBackends } from "@/api/runs";
import {
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "@/lib/experimentExecutionAdapter";
import { DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT } from "@/lib/experimentExecutionEnvironment";

import {
  useNewExperimentExecutionEnvironment,
} from "./useNewExperimentExecutionEnvironment";
import type { RunExecutionBackendCapability } from "@/types/runs";

vi.mock("@/api/runs", () => ({
  getRunExecutionBackends: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>,
    );
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      queryClient.clear();
      container.remove();
    },
  };
}

async function flushAsyncUpdates() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const backendCapabilities: RunExecutionBackendCapability[] = [
  {
    backend: "local-python",
    label: "Local Python",
    available: true,
    mode: "in-process",
    supports_progress: true,
    supports_cancellation: true,
    metadata: {},
  },
  {
    backend: "cluster",
    label: "Cluster",
    available: false,
    mode: "in-process",
    supports_progress: false,
    supports_cancellation: false,
    metadata: {
      message: "Cluster execution is typed but no cluster driver is configured.",
    },
  },
  {
    backend: "wasm-local",
    label: "WASM Local",
    available: false,
    mode: "in-process",
    supports_progress: false,
    supports_cancellation: false,
    metadata: {
      message: "WASM local execution is typed but no WASM driver is configured.",
    },
  },
];

afterEach(() => {
  delete window.nirs4allStudioExecutionEnvironment;
  vi.mocked(getRunExecutionBackends).mockReset();
});

describe("useNewExperimentExecutionEnvironment", () => {
  it("exposes the current legacy execution environment as the route default", async () => {
    vi.mocked(getRunExecutionBackends).mockRejectedValue(new Error("offline"));

    const mounted = await renderHook(useNewExperimentExecutionEnvironment);

    expect(mounted.result.current).toBe(DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT);
    expect(mounted.result.current!.availableExecutionAdapters).toBe(DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS);
    expect(mounted.result.current!.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(mounted.result.current!.launchSubmitters).toEqual({});
    expect(mounted.result.current!.nativeBackendAvailability).toEqual([
      expect.objectContaining({ backend: "cluster", status: "not_configured" }),
      expect.objectContaining({ backend: "wasm-local", status: "not_configured" }),
    ]);

    await mounted.unmount();
  });

  it("merges backend capability data from the runs API", async () => {
    vi.mocked(getRunExecutionBackends).mockResolvedValue({
      default_backend: "local-python",
      backends: backendCapabilities,
    });

    const mounted = await renderHook(useNewExperimentExecutionEnvironment);
    await flushAsyncUpdates();

    expect(mounted.result.current!.executionBackendCapabilities).toEqual(backendCapabilities);
    expect(mounted.result.current!.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(mounted.result.current!.nativeBackendAvailability).toEqual([
      expect.objectContaining({ backend: "cluster", status: "backend_unavailable" }),
      expect.objectContaining({ backend: "wasm-local", status: "backend_unavailable" }),
    ]);
    expect(mounted.result.current!.diagnostics).toMatchObject({
      availableExecutionBackends: ["local-python"],
      unavailableExecutionBackends: ["cluster", "wasm-local"],
      unavailableNativeBackends: ["cluster", "wasm-local"],
    });

    await mounted.unmount();
  });

  it("wires native adapters from the browser execution-environment bridge", async () => {
    vi.mocked(getRunExecutionBackends).mockRejectedValue(new Error("offline"));
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const submitWasmLocalRun = vi.fn(async () => ({ id: "wasm-run-1" }) as never);

    window.nirs4allStudioExecutionEnvironment = {
      submitClusterRun,
      submitWasmLocalRun,
    };

    const mounted = await renderHook(useNewExperimentExecutionEnvironment);

    expect(mounted.result.current!.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(mounted.result.current!.launchSubmitters).toEqual({
      submitClusterRun,
      submitWasmLocalRun,
    });
    expect(mounted.result.current!.nativeBackendAvailability).toEqual([
      expect.objectContaining({ backend: "cluster", status: "available" }),
      expect.objectContaining({ backend: "wasm-local", status: "available" }),
    ]);

    await mounted.unmount();
  });

  it("ignores malformed bridge values at runtime", async () => {
    vi.mocked(getRunExecutionBackends).mockRejectedValue(new Error("offline"));
    window.nirs4allStudioExecutionEnvironment = {
      submitClusterRun: "not-a-function",
      submitWasmLocalRun: null,
    } as never;

    const mounted = await renderHook(useNewExperimentExecutionEnvironment);

    expect(mounted.result.current).toBe(DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT);
    expect(mounted.result.current!.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(mounted.result.current!.launchSubmitters).toEqual({});

    await mounted.unmount();
  });

  it("keeps valid partial bridge submitters", async () => {
    vi.mocked(getRunExecutionBackends).mockRejectedValue(new Error("offline"));
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);

    window.nirs4allStudioExecutionEnvironment = {
      submitClusterRun,
      submitWasmLocalRun: "not-a-function",
    } as never;

    const mounted = await renderHook(useNewExperimentExecutionEnvironment);

    expect(mounted.result.current!.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(mounted.result.current!.launchSubmitters).toEqual({ submitClusterRun });
    expect(mounted.result.current!.nativeBackendAvailability).toEqual([
      expect.objectContaining({ backend: "cluster", status: "available" }),
      expect.objectContaining({ backend: "wasm-local", status: "not_configured" }),
    ]);

    await mounted.unmount();
  });
});
