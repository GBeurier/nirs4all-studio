/**
 * Predict API client functions.
 */

import { api, requestForm } from "./transport";
import type {
  AvailableModelsResponse,
  PredictRequest,
  PredictResponse,
} from "@/types/predict";
import { STRICT_NATIVE_RUNTIME_ENGINE } from "@/lib/runtimeBackendPreference";

export async function getAvailableModels(): Promise<AvailableModelsResponse> {
  return api.get("/models/available");
}

export async function runPrediction(
  request: PredictRequest
): Promise<PredictResponse> {
  return api.post("/predict", {
    ...request,
    engine: STRICT_NATIVE_RUNTIME_ENGINE,
    allow_fallback: false,
  });
}

function predictionErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return "Prediction failed";
}

export async function runPredictionWithFile(
  modelId: string,
  modelSource: string,
  file: File,
  options: { archive_fingerprint?: string; output_index?: number; has_header?: boolean } = {},
): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("model_id", modelId);
  formData.append("model_source", modelSource);
  formData.append("file", file);
  formData.append("engine", STRICT_NATIVE_RUNTIME_ENGINE);
  formData.append("allow_fallback", "false");
  if (options.archive_fingerprint) formData.append("archive_fingerprint", options.archive_fingerprint);
  if (options.output_index !== undefined) formData.append("output_index", String(options.output_index));
  if (options.has_header !== undefined) formData.append("has_header", String(options.has_header));

  try {
    return await requestForm<PredictResponse>("/predict/file", formData);
  } catch (error) {
    throw new Error(predictionErrorMessage(error));
  }
}
