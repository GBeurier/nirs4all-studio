/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getKeywordRegistry } from "@/api/system";
import { useKeywordRegistry } from "./useKeywordRegistry";

vi.mock("@/api/system", () => ({
  getKeywordRegistry: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mockedGetKeywordRegistry = vi.mocked(getKeywordRegistry);
let mountedContainers: HTMLDivElement[] = [];

function registryPayload() {
  return {
    entries: [
      {
        aliases: [],
        canonical_term: "native_tuning",
        changes: ["tuning_result"],
        docs_anchor: "native-tuning",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "run.tuning",
        invalidates_calibration: "if_predictor_changes",
        lifecycle_stage: "tuning",
        path: "run.tuning",
        reads: ["pipeline", "score_data"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Runs native optimizer selection before final calibration.",
        surface: "run_argument",
        token: "tuning",
        ui: { control: "object", group: "tuning", label: "Native tuning", order: 100 },
        value_schema: { type: "object" },
      },
    ],
    registry_version: "1.0.0",
    schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
    schema_version: 1,
    scope: "lifecycle-v1",
  };
}

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

function HookProbe() {
  const registry = useKeywordRegistry();
  return (
    <div>
      <span data-testid="state">
        {registry.isLoading ? "loading" : registry.isError ? "error" : "ready"}
      </span>
      <span data-testid="entry-count">{registry.data?.entries.length ?? 0}</span>
      <span data-testid="error">{registry.error?.message ?? ""}</span>
    </div>
  );
}

async function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const result = await render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  );

  return {
    ...result,
    queryClient,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe("useKeywordRegistry", () => {
  it("loads and parses the public keyword registry", async () => {
    mockedGetKeywordRegistry.mockResolvedValue(registryPayload());
    const { container, queryClient, root } = await renderWithQueryClient(<HookProbe />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='state']")?.textContent).toBe("ready");
    });

    expect(container.querySelector("[data-testid='entry-count']")?.textContent).toBe("1");

    queryClient.clear();
    await act(async () => {
      root.unmount();
    });
  });

  it("fails closed when the registry payload does not match the public schema", async () => {
    mockedGetKeywordRegistry.mockResolvedValue({ entries: [] });
    const { container, queryClient, root } = await renderWithQueryClient(<HookProbe />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='state']")?.textContent).toBe("error");
    });

    expect(container.querySelector("[data-testid='entry-count']")?.textContent).toBe("0");
    expect(container.querySelector("[data-testid='error']")?.textContent).toContain("keyword registry");

    queryClient.clear();
    await act(async () => {
      root.unmount();
    });
  });
});
