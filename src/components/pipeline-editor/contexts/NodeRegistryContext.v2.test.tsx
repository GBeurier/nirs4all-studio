/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeRegistryProvider, useNodeRegistry } from "./NodeRegistryContext.v2";

const mocks = vi.hoisted(() => ({
  usePipelineEditorPreferencesOptional: vi.fn(() => ({ extendedMode: true })),
}));

vi.mock("./PipelineEditorPreferencesContext", () => ({
  usePipelineEditorPreferencesOptional: mocks.usePipelineEditorPreferencesOptional,
}));

vi.mock("@/data/nodes", () => ({
  NodeRegistry: class {
    version = "test";

    constructor(private nodes: unknown[]) {
      this.nodes = nodes;
    }

    getByType() {
      return [];
    }

    getByTypeAndName() {
      return undefined;
    }

    getById() {
      return undefined;
    }

    getByClassPath() {
      return undefined;
    }

    getTypes() {
      return [];
    }

    resolveClassPath() {
      return undefined;
    }

    resolveNameFromClassPath() {
      return undefined;
    }

    search() {
      return [];
    }

    getDefaultParams() {
      return {};
    }

    getParameterDef() {
      return undefined;
    }

    getSweepableParams() {
      return [];
    }

    getCategoryConfig() {
      return undefined;
    }

    getStats() {
      return { count: this.nodes.length };
    }
  },
  createNodeRegistry: () => ({
    getAll: () => [],
  }),
  CustomNodeStorage: {
    getInstance: () => ({
      getAllMerged: () => [],
      subscribe: () => () => undefined,
    }),
  },
  mergeNodeDefinitions: (preferred: unknown[], extended: unknown[]) => [...preferred, ...extended],
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface RenderResult {
  result: {
    current?: ReturnType<typeof useNodeRegistry>;
  };
  unmount: () => Promise<void>;
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

async function renderProvider(): Promise<RenderResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: RenderResult["result"] = {};

  function Probe() {
    result.current = useNodeRegistry();
    return null;
  }

  await act(async () => {
    root.render(
      <NodeRegistryProvider useJsonRegistry>
        <Probe />
      </NodeRegistryProvider>,
    );
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("NodeRegistryProvider", () => {
  it("retries extended registry fetch failures and clears the warning once it loads", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });
    vi.stubGlobal("fetch", fetchMock);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const view = await renderProvider();

    await waitFor(() => {
      expect(view.result.current?.extendedError?.message).toBe("network down");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => {
      expect(view.result.current?.extendedError).toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
    await view.unmount();
  });
});
