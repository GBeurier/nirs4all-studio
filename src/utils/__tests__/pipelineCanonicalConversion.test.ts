import { describe, expect, it, vi } from "vitest";
import {
  exportToNirs4all as exportCanonicalToNirs4all,
  importFromNirs4all as importCanonicalFromNirs4all,
} from "../pipelineCanonicalConversion";
import {
  exportToNirs4all as exportFacadeToNirs4all,
  importFromNirs4all as importFacadeFromNirs4all,
} from "../pipelineConverter";
import type {
  Nirs4allPipeline,
  Nirs4allStep,
} from "../nirs4allPipelineTypes";

describe("pipelineCanonicalConversion", () => {
  it("imports canonical pipeline payloads and exports them with an optional wrapper", () => {
    const canonical: Nirs4allPipeline = {
      name: "demo",
      description: "Demo pipeline",
      pipeline: [
        {
          class: "sklearn.preprocessing._data.MinMaxScaler",
          params: { feature_range: [0, 1] },
        },
        {
          model: {
            class: "sklearn.linear_model.Ridge",
            params: { alpha: 2 },
          },
          name: "Ridge-demo",
        },
      ],
    };

    const editorSteps = importCanonicalFromNirs4all(canonical);

    expect(editorSteps).toHaveLength(2);
    expect(editorSteps[0]).toMatchObject({
      type: "preprocessing",
      name: "MinMaxScaler",
    });
    expect(editorSteps[1]).toMatchObject({
      type: "model",
      name: "Ridge",
      customName: "Ridge-demo",
    });

    const exported = exportCanonicalToNirs4all(editorSteps, {
      includeWrapper: true,
      name: "wrapped",
      description: "Wrapped pipeline",
    }) as Nirs4allPipeline;

    expect(exported.name).toBe("wrapped");
    expect(exported.description).toBe("Wrapped pipeline");
    expect(exported.pipeline).toHaveLength(2);
    expect((exported.pipeline[0] as { class: string }).class).toContain("MinMaxScaler");
    expect((exported.pipeline[1] as { model: { class: string } }).model.class).toBe("sklearn.linear_model.Ridge");
  });

  it("keeps raw unsupported canonical steps exportable", () => {
    const rawStep = {
      unknown_dag_ml_step: {
        backend: "dag-ml",
        schema: { inputs: ["spectral"] },
      },
    } as unknown as Nirs4allStep;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const editorSteps = importCanonicalFromNirs4all([rawStep]);

      expect(editorSteps[0]).toMatchObject({
        type: "preprocessing",
        name: "Unknown",
      });
      expect(exportCanonicalToNirs4all(editorSteps)).toEqual([rawStep]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps the historical pipelineConverter facade bound to the canonical adapter", () => {
    expect(importFacadeFromNirs4all).toBe(importCanonicalFromNirs4all);
    expect(exportFacadeToNirs4all).toBe(exportCanonicalToNirs4all);
  });
});
