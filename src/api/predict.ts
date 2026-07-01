/**
 * Predict API client functions.
 */

import { api, getApiBaseUrl } from "./transport";
import type {
  AvailableModelsResponse,
  PredictRequest,
  PredictResponse,
} from "@/types/predict";

export async function getAvailableModels(): Promise<AvailableModelsResponse> {
  return api.get("/models/available");
}

export async function runPrediction(
  request: PredictRequest
): Promise<PredictResponse> {
  return api.post("/predict", request);
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
  options: { engine?: string | null; allowFallback?: boolean } = {}
): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("model_id", modelId);
  formData.append("model_source", modelSource);
  formData.append("file", file);
  if (options.engine) {
    formData.append("engine", options.engine);
  }
  if (options.allowFallback !== undefined) {
    formData.append("allow_fallback", String(options.allowFallback));
  }

  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}/predict/file`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(predictionErrorMessage(error));
  }

  return response.json();
}
