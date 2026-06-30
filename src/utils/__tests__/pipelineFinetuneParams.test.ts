import { describe, expect, it } from "vitest";
import {
  normalizeSearchSpaceRawValue,
  normalizeSearchSpaceToken,
  parseFinetuneParamConfig,
  serializeFinetuneParamConfig,
  serializeNamedFinetuneParams,
} from "../pipelineFinetuneParams";

describe("pipelineFinetuneParams", () => {
  it("normalizes legacy search-space tokens", () => {
    expect(normalizeSearchSpaceToken("float_log")).toBe("log_float");
    expect(normalizeSearchSpaceToken("log_float")).toBe("log_float");
    expect(normalizeSearchSpaceToken("unknown")).toBeUndefined();
    expect(normalizeSearchSpaceRawValue(["float_log", 1e-4, 1e2])).toEqual([
      "log_float",
      1e-4,
      1e2,
    ]);
    expect(normalizeSearchSpaceRawValue({ type: "float_log", low: 0.01 })).toEqual({
      type: "log_float",
      low: 0.01,
    });
  });

  it("parses tuple and explicit categorical search spaces", () => {
    expect(parseFinetuneParamConfig("filters", ["int", 8, 32])).toMatchObject({
      name: "filters",
      type: "int",
      low: 8,
      high: 32,
      rawValue: ["int", 8, 32],
    });
    expect(parseFinetuneParamConfig("activation", ["categorical", ["relu", "tanh"]])).toMatchObject({
      name: "activation",
      type: "categorical",
      choices: ["relu", "tanh"],
      rawValue: ["categorical", ["relu", "tanh"]],
    });
    expect(parseFinetuneParamConfig("batch_size", [16, 32, 64])).toMatchObject({
      name: "batch_size",
      type: "categorical",
      choices: [16, 32, 64],
      rawValue: [16, 32, 64],
    });
  });

  it("parses object search spaces and preserves normalized raw values", () => {
    expect(parseFinetuneParamConfig("gamma", {
      type: "float_log",
      low: 0.01,
      high: 1.0,
    })).toMatchObject({
      name: "gamma",
      type: "log_float",
      low: 0.01,
      high: 1.0,
      rawValue: {
        type: "log_float",
        low: 0.01,
        high: 1.0,
      },
    });
  });

  it("serializes unchanged imported raw values", () => {
    const tupleParam = parseFinetuneParamConfig("alpha", ["float_log", 1e-4, 1e2]);
    const objectParam = parseFinetuneParamConfig("gamma", {
      type: "float_log",
      low: 0.01,
      high: 1.0,
    });

    expect(serializeFinetuneParamConfig(tupleParam)).toEqual(["log_float", 1e-4, 1e2]);
    expect(serializeFinetuneParamConfig(objectParam)).toEqual({
      type: "log_float",
      low: 0.01,
      high: 1.0,
    });
  });

  it("serializes edited imported params from current fields", () => {
    const tupleParam = {
      ...parseFinetuneParamConfig("alpha", ["float_log", 1e-4, 1e2]),
      high: 10,
    };
    const objectParam = {
      ...parseFinetuneParamConfig("gamma", { type: "log_float", low: 0.01, high: 1.0 }),
      low: 0.02,
    };

    expect(serializeNamedFinetuneParams([tupleParam, objectParam])).toEqual({
      alpha: {
        type: "log_float",
        low: 1e-4,
        high: 10,
        log: true,
      },
      gamma: {
        type: "log_float",
        low: 0.02,
        high: 1.0,
        log: true,
      },
    });
  });
});
