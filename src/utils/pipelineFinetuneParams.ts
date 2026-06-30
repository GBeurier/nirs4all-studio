import type { FinetuneParamConfig, FinetuneParamType } from "@/components/pipeline-editor/types";
import { cloneParamValue } from "./pipelineValueUtils";

const SEARCH_SPACE_TOKEN_ALIASES = new Map<string, FinetuneParamType>([["float_log", "log_float"]]);
const SEARCH_SPACE_TOKENS = new Set<FinetuneParamType>(["int", "float", "categorical", "log_float"]);

export function normalizeSearchSpaceToken(token: unknown): FinetuneParamType | undefined {
  if (typeof token !== "string") {
    return undefined;
  }

  const normalized = SEARCH_SPACE_TOKEN_ALIASES.get(token) || token;
  if (!SEARCH_SPACE_TOKENS.has(normalized as FinetuneParamType)) {
    return undefined;
  }

  return normalized as FinetuneParamType;
}

export function normalizeSearchSpaceRawValue(value: unknown): unknown {
  const normalized = cloneParamValue(value);

  if (
    Array.isArray(normalized) &&
    normalized.length > 0 &&
    typeof normalized[0] === "string"
  ) {
    const normalizedToken = normalizeSearchSpaceToken(normalized[0]);
    if (normalizedToken) {
      normalized[0] = normalizedToken;
    }
    return normalized;
  }

  if (normalized && typeof normalized === "object") {
    const record = normalized as Record<string, unknown>;
    if (record.type === "float_log") {
      record.type = "log_float";
    }
  }

  return normalized;
}

export function parseFinetuneParamConfig(
  name: string,
  config: unknown
): FinetuneParamConfig {
  if (Array.isArray(config)) {
    const [token, ...rest] = config;
    const normalizedToken = normalizeSearchSpaceToken(token);
    if (normalizedToken) {
      if (normalizedToken === "categorical") {
        const choices = Array.isArray(rest[0]) ? rest[0] : rest;
        return {
          name,
          type: "categorical",
          choices: choices as (string | number)[],
          rawValue: normalizeSearchSpaceRawValue(config),
        };
      }
      return {
        name,
        type: normalizedToken,
        low: rest[0] as number | undefined,
        high: rest[1] as number | undefined,
        step: rest[2] as number | undefined,
        rawValue: normalizeSearchSpaceRawValue(config),
      };
    }
    return {
      name,
      type: "categorical",
      choices: config as (string | number)[],
      rawValue: cloneParamValue(config),
    };
  }

  const paramConfig = config as {
    type?: string;
    low?: number;
    high?: number;
    step?: number;
    log?: boolean;
    choices?: (string | number)[];
  };
  const normalizedType = paramConfig.log
    ? "log_float"
    : normalizeSearchSpaceToken(paramConfig.type) || paramConfig.type;
  return {
    name,
    type: (normalizedType as FinetuneParamType) || "int",
    low: paramConfig.low,
    high: paramConfig.high,
    step: paramConfig.step,
    choices: paramConfig.choices,
    rawValue: normalizeSearchSpaceRawValue(config),
  };
}

function areFinetuneParamValuesEquivalent(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) =>
      areFinetuneParamValuesEquivalent(value, right[index])
    );
  }

  if (left && typeof left === "object") {
    if (!right || typeof right !== "object") {
      return false;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every(
      (key) =>
        key in rightRecord &&
        areFinetuneParamValuesEquivalent(leftRecord[key], rightRecord[key])
    );
  }

  return left === right;
}

function getComparableFinetuneParamShape(
  param: Pick<FinetuneParamConfig, "type" | "low" | "high" | "step" | "choices">
): Record<string, unknown> {
  if (param.type === "categorical") {
    return {
      type: "categorical",
      choices: cloneParamValue(param.choices || []),
    };
  }

  return {
    type: param.type,
    low: param.low,
    high: param.high,
    step: param.step,
  };
}

function shouldReuseRawFinetuneParamValue(param: FinetuneParamConfig): boolean {
  if (param.rawValue === undefined) {
    return false;
  }

  const parsedRawValue = parseFinetuneParamConfig(param.name, param.rawValue);
  return areFinetuneParamValuesEquivalent(
    getComparableFinetuneParamShape(param),
    getComparableFinetuneParamShape(parsedRawValue)
  );
}

export function serializeFinetuneParamConfig(param: FinetuneParamConfig): unknown {
  if (shouldReuseRawFinetuneParamValue(param)) {
    return cloneParamValue(param.rawValue);
  }

  if (param.type === "categorical") {
    return cloneParamValue(param.choices || []);
  }

  const paramConfig: Record<string, unknown> = { type: param.type };
  if (param.low !== undefined) paramConfig.low = param.low;
  if (param.high !== undefined) paramConfig.high = param.high;
  if (param.step !== undefined) paramConfig.step = param.step;
  if (param.type === "log_float") paramConfig.log = true;
  return paramConfig;
}

export function serializeNamedFinetuneParams(
  params: FinetuneParamConfig[]
): Record<string, unknown> {
  const serializedParams: Record<string, unknown> = {};

  for (const param of params) {
    serializedParams[param.name] = serializeFinetuneParamConfig(param);
  }

  return serializedParams;
}
