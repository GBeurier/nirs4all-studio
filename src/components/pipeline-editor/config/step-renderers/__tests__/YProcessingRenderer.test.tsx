// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { YProcessingConfig } from "../../../yProcessingConfig";
import type { PipelineStep } from "../../../types";
import { exportToNirs4all } from "@/utils/pipelineConverter";
import { YProcessingRenderer } from "../YProcessingRenderer";

let panel: { config: YProcessingConfig; onChange(config: YProcessingConfig): void };
vi.mock("../../../YProcessingPanel", () => ({ YProcessingPanel: (props: typeof panel) => { panel = props; return null; } }));
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => children }));
vi.mock("../StepActions", () => ({ StepActions: () => null }));

const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); });

it("edits the actual executable target transformer and retains its saved parameters", async () => {
  let step: PipelineStep = { id: "target", type: "y_processing", name: "IntegerKBinsDiscretizer", params: { n_bins: 3, strategy: "uniform" } };
  root = createRoot(container);
  const update = vi.fn((_id: string, patch: Partial<PipelineStep>) => { step = { ...step, ...patch }; });
  await act(async () => root.render(<YProcessingRenderer step={step} onUpdate={update} onRemove={vi.fn()} onDuplicate={vi.fn()} />));
  expect(panel.config).toMatchObject({ enabled: true, scaler: "IntegerKBinsDiscretizer", params: { n_bins: 3, strategy: "uniform" } });
  await act(async () => panel.onChange({ enabled: true, scaler: "RangeDiscretizer", params: { bins: "10,20" } }));
  expect(step.name).toBe("RangeDiscretizer");
  expect(exportToNirs4all([step])).toEqual([{
    y_processing: { class: "nirs4all.operators.transforms.targets.RangeDiscretizer", params: { bins: [10, 20] } },
  }]);
  await act(async () => panel.onChange({ enabled: false, scaler: "RangeDiscretizer", params: { bins: "10,20" } }));
  expect(exportToNirs4all([step])).toEqual([]);
});

it.each([
  ["MinMaxScaler", { feature_range: [-1, 1] }, { feature_range: [-1, 1] }],
  ["RangeDiscretizer", { ranges: "10,20" }, { bins: [10, 20] }],
  ["RangeDiscretizer", { bins: [7, 13] }, { bins: [7, 13] }],
  ["RangeDiscretizer", {}, { bins: 5 }],
])("preserves imported %s parameters when toggling the editor", async (name, params, expected) => {
  let step: PipelineStep = { id: "target", type: "y_processing", name, params };
  root = createRoot(container);
  const update = vi.fn((_id: string, patch: Partial<PipelineStep>) => { step = { ...step, ...patch }; });
  await act(async () => root.render(<YProcessingRenderer step={step} onUpdate={update} onRemove={vi.fn()} onDuplicate={vi.fn()} />));
  await act(async () => panel.onChange({ ...panel.config, enabled: false }));
  await act(async () => panel.onChange({ ...panel.config, enabled: true }));
  const exported = exportToNirs4all([step]);
  expect(exported).toEqual([{ y_processing: { class: expect.stringContaining(name), params: expected } }]);
});
