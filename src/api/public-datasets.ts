/**
 * Public dataset catalogue client — browse the nirs4all-datasets public
 * catalogue and import a public dataset into the active workspace as a job.
 */

import { api } from "./transport";
import type { Dataset } from "@/types/datasets";

/** Catalogue entry published by the nirs4all-datasets package. */
export interface PublicDataset {
  id: string;
  name: string;
  domain: string | null;
  spectro_family: string | null;
  n_samples: number | null;
  n_features_total: number | null;
  n_targets: number;
  n_sources: number;
  source_ids: string[];
  license: string;
  targets: string[];
}

export interface PublicDatasetCatalog {
  datasets: PublicDataset[];
  version: string;
}

export interface PublicDatasetImportRequest {
  dataset_id: string;
  source_id?: string;
}

export interface PublicDatasetImportSubmission {
  job_id: string;
  status: string;
}

export type PublicDatasetImportStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PublicDatasetImportSnapshot {
  id: string;
  status: PublicDatasetImportStatus;
  cancellation_requested?: boolean;
  progress: number | null;
  progress_message: string;
  error: string | null;
  result: { success: true; dataset: Dataset } | null;
}

const PUBLIC_DATASET_PAGE_BASE = "https://datasets.nirs4all.org/dataset/";

/** Public catalogue page describing one dataset. */
export function publicDatasetPageUrl(datasetId: string): string {
  return `${PUBLIC_DATASET_PAGE_BASE}${encodeURIComponent(datasetId)}.html`;
}

export async function listPublicDatasets(): Promise<PublicDatasetCatalog> {
  return api.get("/datasets/public");
}

export async function startPublicDatasetImport(
  request: PublicDatasetImportRequest,
): Promise<PublicDatasetImportSubmission> {
  return api.post("/datasets/public/import", request);
}

export async function getPublicDatasetImport(
  jobId: string,
): Promise<PublicDatasetImportSnapshot> {
  return api.get(`/datasets/public/imports/${encodeURIComponent(jobId)}`);
}

export async function cancelPublicDatasetImport(jobId: string): Promise<unknown> {
  return api.post(`/datasets/public/imports/${encodeURIComponent(jobId)}/cancel`);
}
