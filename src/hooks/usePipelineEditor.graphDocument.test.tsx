/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  EDITOR_GRAPH_DOCUMENT_VERSION,
  compareLegacyStepsToEditorGraphDocument,
} from "@/lib/editorGraphDocument";
import { usePipelineEditor } from "./usePipelineEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const initialSteps: PipelineStep[] = [
  { id: "pre", type: "preprocessing", name: "SNV", params: { with_mean: true } },
  { id: "model", type: "model", name: "PLS", params: { n_components: 8 } },
];

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    rerender: async () => {
      await act(async () => {
        root.render(<TestComponent />);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("usePipelineEditor editorGraphDocument seam", () => {
  it("derives an editor graph document equivalent to the legacy steps", async () => {
    const { result, unmount } = await renderHook(() =>
      usePipelineEditor({
        initialSteps,
        initialName: "PLS Pipeline",
        pipelineId: "pipe-1",
        persistState: false,
        allowPersistedState: false,
      })
    );

    const document = result.current?.editorGraphDocument;
    expect(document).toBeDefined();
    expect(document).toMatchObject({
      id: "pipe-1",
      name: "PLS Pipeline",
      version: EDITOR_GRAPH_DOCUMENT_VERSION,
      source: "legacy-editor",
      rootNodeIds: ["pre", "model"],
    });

    const comparison = compareLegacyStepsToEditorGraphDocument(
      result.current?.steps ?? [],
      document!
    );
    expect(comparison.equivalent).toBe(true);

    await unmount();
  });

  it("keeps the derived document referentially stable until steps change", async () => {
    let editorApi: ReturnType<typeof usePipelineEditor> | undefined;

    const { result, rerender, unmount } = await renderHook(() => {
      editorApi = usePipelineEditor({
        initialSteps,
        pipelineId: "pipe-2",
        persistState: false,
        allowPersistedState: false,
      });
      return editorApi;
    });

    const firstDocument = result.current?.editorGraphDocument;
    await rerender();
    expect(result.current?.editorGraphDocument).toBe(firstDocument);

    await act(async () => {
      editorApi?.addStep("preprocessing", {
        name: "MSC",
        description: "Multiplicative scatter correction",
        defaultParams: {},
      });
    });

    expect(result.current?.editorGraphDocument).not.toBe(firstDocument);
    expect(result.current?.editorGraphDocument.nodes.length).toBeGreaterThan(
      firstDocument?.nodes.length ?? 0
    );

    await unmount();
  });
});
