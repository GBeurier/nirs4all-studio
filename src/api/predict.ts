/**
 * Predict API client functions.
 */

import { api, getApiBaseUrl } from "./client";
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

export async function runPredictionWithFile(
  modelId: string,
  modelSource: string,
  file: File
): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("model_id", modelId);
  formData.append("model_source", modelSource);
  formData.append("file", file);

  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}/predict/file`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Prediction failed");
  }

  return response.json();
}
