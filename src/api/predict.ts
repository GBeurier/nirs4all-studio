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
): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("model_id", modelId);
  formData.append("model_source", modelSource);
  formData.append("file", file);
  formData.append("engine", STRICT_NATIVE_RUNTIME_ENGINE);
  formData.append("allow_fallback", "false");

  try {
    return await requestForm<PredictResponse>("/predict/file", formData);
  } catch (error) {
    throw new Error(predictionErrorMessage(error));
  }
}
