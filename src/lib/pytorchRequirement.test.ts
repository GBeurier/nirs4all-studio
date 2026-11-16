import { describe, expect, it } from "vitest";

import { envReport, recommendedPackage } from "@/components/python-env/__tests__/fixtures";
import { allNodes } from "@/data/nodes";
import {
  lacksInstallablePyTorch,
  pyTorchNeedOfOperator,
  requiresPyTorch,
  stepsNeedPyTorch,
} from "./pytorchRequirement";

const NICON_PATH = "nirs4all.operators.models.pytorch.nicon.nicon";

describe("requiresPyTorch", () => {
  it("attributes exactly the registry operators that declare torch", () => {
    const names = allNodes.filter((node) => requiresPyTorch(node.requires)).map((node) => node.name).sort();
    expect(names).toEqual([
      "CNN1D",
      "CNN1DClassifier",
      "NICoN",
      "NICoNClassifier",
      "Transformer",
      "TransformerClassifier",
    ]);
  });

  it.each([
    ["no declared package", undefined],
    ["an empty declaration", []],
    ["another package", ["tabpfn"]],
    ["PyTorch plus another package", ["torch", "tabpfn"]],
  ])("does not attribute %s to PyTorch", (_label, requires) => {
    expect(requiresPyTorch(requires)).toBe(false);
  });

  it("names the model in the need of a PyTorch operator only", () => {
    expect(pyTorchNeedOfOperator({ name: "NICoN", requires: ["torch"] })).toEqual({ kind: "model", name: "NICoN" });
    expect(pyTorchNeedOfOperator({ name: "TabPFN", requires: ["tabpfn"] })).toBeNull();
    expect(pyTorchNeedOfOperator({ name: "PLSRegression" })).toBeNull();
  });
});

describe("lacksInstallablePyTorch", () => {
  const torch = (overrides: Parameters<typeof recommendedPackage>[0]) =>
    envReport({ recommended: [recommendedPackage({ name: "torch", installedVersion: null, status: "missing", ...overrides })] });

  it("holds for a writable environment whose listing reports PyTorch missing", () => {
    expect(lacksInstallablePyTorch(torch({}))).toBe(true);
  });

  it.each([
    ["a read-only environment", { ...torch({}), writable: false }],
    ["an installed PyTorch", torch({ installedVersion: "2.6.0", status: "ok" })],
    ["an older PyTorch", torch({ installedVersion: "2.1.0", status: "older" })],
    ["an unsupported Python version", torch({ status: "unsupported_python" })],
    ["a catalogue without PyTorch", envReport({ recommended: [recommendedPackage()] })],
    ["no environment", null],
  ])("does not hold for %s", (_label, report) => {
    expect(lacksInstallablePyTorch(report)).toBe(false);
  });
});

describe("stepsNeedPyTorch", () => {
  const pls = { id: "pls", type: "model", name: "PLSRegression", classPath: "sklearn.cross_decomposition.PLSRegression", params: {} };
  const nicon = { id: "nicon", type: "model", name: "NICoN", classPath: NICON_PATH, params: {} };

  it("finds a PyTorch model by class path, function path, legacy path or name", () => {
    expect(stepsNeedPyTorch([pls, nicon])).toBe(true);
    expect(stepsNeedPyTorch([{ id: "f", type: "model", name: "custom", functionPath: NICON_PATH }])).toBe(true);
    expect(stepsNeedPyTorch([{ id: "l", type: "model", name: "old", classPath: "nirs4all.operators.models.deep.nicon" }])).toBe(true);
    expect(stepsNeedPyTorch([{ id: "n", type: "model", name: "nicon", params: {} }])).toBe(true);
  });

  it("finds a PyTorch model nested in branches, named branches and children", () => {
    expect(stepsNeedPyTorch([{ id: "b", type: "flow", name: "Branch", branches: [[pls], [nicon]] }])).toBe(true);
    expect(stepsNeedPyTorch([{ id: "n", type: "flow", name: "Branch", namedBranches: { deep: [nicon] } }])).toBe(true);
    expect(stepsNeedPyTorch([{ id: "c", type: "flow", name: "Sequential", children: [{ ...pls, children: [nicon] }] }])).toBe(true);
  });

  it("ignores pipelines without PyTorch models, other frameworks and disabled steps", () => {
    expect(stepsNeedPyTorch([])).toBe(false);
    expect(stepsNeedPyTorch([pls, { id: "t", type: "model", name: "TabPFN", classPath: "tabpfn.TabPFNRegressor" }])).toBe(false);
    expect(stepsNeedPyTorch([{ id: "m", type: "model", name: "MLPRegressor", classPath: "sklearn.neural_network.MLPRegressor" }])).toBe(false);
    expect(stepsNeedPyTorch([{ ...nicon, enabled: false }])).toBe(false);
    expect(stepsNeedPyTorch([{ id: "b", type: "flow", name: "Branch", enabled: false, branches: [[nicon]] }])).toBe(false);
    // The path decides when a step has one: a same-named operator from elsewhere is not PyTorch.
    expect(stepsNeedPyTorch([{ id: "x", type: "model", name: "Transformer", classPath: "my_lab.models.Transformer" }])).toBe(false);
    expect(stepsNeedPyTorch(["not a step", null])).toBe(false);
  });
});
