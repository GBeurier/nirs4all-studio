import { describe, it, expect, vi } from "vitest";
import {
  buildCommandActions,
  filterCommandActions,
  findSelectedStep,
  flattenSteps,
  groupCommandActions,
  type CommandActionHandlers,
} from "../commandPaletteData";
import type { PipelineStep, StepOption, StepType } from "../types";

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "s1",
    type: "preprocessing",
    name: "Step 1",
    params: {},
    ...overrides,
  };
}

function makeHandlers(overrides: Partial<CommandActionHandlers> = {}): CommandActionHandlers {
  return {
    onAddStep: vi.fn(),
    onSelectStep: vi.fn(),
    onOpenChange: vi.fn(),
    ...overrides,
  };
}

const noOptions = (_type: StepType): StepOption[] => [];

describe("flattenSteps", () => {
  it("returns a flat entry per top-level step using its name as path", () => {
    const steps = [makeStep({ id: "a", name: "A" }), makeStep({ id: "b", name: "B" })];
    const flat = flattenSteps(steps);
    expect(flat.map((f) => f.step.id)).toEqual(["a", "b"]);
    expect(flat.map((f) => f.path)).toEqual(["A", "B"]);
  });

  it("descends into branches and builds an arrow-joined path with branch labels", () => {
    const steps = [
      makeStep({
        id: "root",
        name: "Root",
        type: "flow",
        branches: [[makeStep({ id: "child", name: "Child" })]],
      }),
    ];
    const flat = flattenSteps(steps);
    const child = flat.find((f) => f.step.id === "child");
    expect(child?.path).toBe("Root → Branch 1 → Child");
  });

  it("uses generator-kind specific branch labels", () => {
    const steps = [
      makeStep({
        id: "gen",
        name: "Gen",
        type: "flow",
        generatorKind: "cartesian",
        branches: [[makeStep({ id: "c", name: "C" })]],
      }),
    ];
    const flat = flattenSteps(steps);
    expect(flat.find((f) => f.step.id === "c")?.path).toBe("Gen → Stage 1 → C");
  });
});

describe("findSelectedStep", () => {
  const flat = flattenSteps([makeStep({ id: "a", name: "A" }), makeStep({ id: "b", name: "B" })]);

  it("returns null when no id is provided", () => {
    expect(findSelectedStep(flat, null)).toBeNull();
  });

  it("resolves a step by id", () => {
    expect(findSelectedStep(flat, "b")?.name).toBe("B");
  });

  it("returns null for an unknown id", () => {
    expect(findSelectedStep(flat, "missing")).toBeNull();
  });
});

describe("filterCommandActions", () => {
  const actions = buildCommandActions({
    steps: [makeStep({ id: "a", name: "Savitzky" })],
    flattenedSteps: flattenSteps([makeStep({ id: "a", name: "Savitzky" })]),
    selectedStep: null,
    selectedStepId: null,
    getStepOptions: noOptions,
    handlers: makeHandlers(),
  });

  it("returns all actions for an empty query", () => {
    expect(filterCommandActions(actions, "  ")).toBe(actions);
  });

  it("matches against label/keywords case-insensitively", () => {
    const filtered = filterCommandActions(actions, "savitzky");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((a) => a.category === "navigation")).toBe(true);
  });

  it("returns nothing for a non-matching query", () => {
    expect(filterCommandActions(actions, "zzz-nomatch")).toHaveLength(0);
  });
});

describe("groupCommandActions", () => {
  it("buckets actions by category preserving order", () => {
    const actions = buildCommandActions({
      steps: [makeStep({ id: "a", name: "A" })],
      flattenedSteps: flattenSteps([makeStep({ id: "a", name: "A" })]),
      selectedStep: null,
      selectedStepId: null,
      getStepOptions: noOptions,
      handlers: makeHandlers({ onSave: vi.fn(), onRun: vi.fn() }),
    });
    const groups = groupCommandActions(actions);
    expect(groups.navigation.map((a) => a.id)).toEqual(["go-to-a"]);
    expect(groups.pipeline.map((a) => a.id)).toEqual(["save-pipeline", "run-pipeline"]);
    expect(groups.step).toEqual([]);
  });
});

describe("buildCommandActions", () => {
  it("omits optional commands when their handler is absent", () => {
    const actions = buildCommandActions({
      steps: [],
      flattenedSteps: [],
      selectedStep: null,
      selectedStepId: null,
      getStepOptions: noOptions,
      handlers: makeHandlers(),
    });
    expect(actions.find((a) => a.id === "save-pipeline")).toBeUndefined();
    expect(actions.find((a) => a.id === "run-pipeline")).toBeUndefined();
  });

  it("emits selected-step commands and wires handlers + onOpenChange", () => {
    const onRemoveStep = vi.fn();
    const onOpenChange = vi.fn();
    const selected = makeStep({ id: "sel", name: "Sel", type: "model", params: { n: 1 } });
    const actions = buildCommandActions({
      steps: [selected],
      flattenedSteps: flattenSteps([selected]),
      selectedStep: selected,
      selectedStepId: "sel",
      getStepOptions: noOptions,
      handlers: makeHandlers({ onRemoveStep, onOpenChange }),
    });

    expect(actions.find((a) => a.id === "configure-step")?.label).toBe("Configure Sel");
    // model step -> finetuning command
    expect(actions.find((a) => a.id === "configure-finetuning")).toBeDefined();
    // numeric param -> sweep command
    expect(actions.find((a) => a.id === "configure-sweep")).toBeDefined();

    const del = actions.find((a) => a.id === "delete-step");
    del?.onSelect();
    expect(onRemoveStep).toHaveBeenCalledWith("sel");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("limits quick-add commands to 3 options per type", () => {
    const options: StepOption[] = Array.from({ length: 5 }, (_, i) => ({
      name: `Opt${i}`,
      description: `desc ${i}`,
      defaultParams: {},
    }));
    const actions = buildCommandActions({
      steps: [],
      flattenedSteps: [],
      selectedStep: null,
      selectedStepId: null,
      getStepOptions: (type) => (type === "preprocessing" ? options : []),
      handlers: makeHandlers(),
    });
    const addActions = actions.filter((a) => a.category === "add-step");
    expect(addActions).toHaveLength(3);
  });
});
