/**
 * Transfer Analysis API client functions.
 */

import { api } from './client';
import type {
  TransferAnalysisRequest,
  TransferAnalysisResponse,
  TransferPresetInfo,
  PreprocessingOptionInfo,
} from '@/types/transfer';

/**
 * Compute comprehensive transfer analysis between multiple datasets.
 *
 * @param request - The analysis request configuration
 * @param signal - Optional AbortSignal for cancellation
 * @returns Transfer analysis results including distance matrices, rankings, PCA coordinates
 */
export async function computeTransferAnalysis(
  request: TransferAnalysisRequest,
  signal?: AbortSignal
): Promise<TransferAnalysisResponse> {
  return api.post<TransferAnalysisResponse>('/analysis/transfer', request, { signal });
}

/**
 * Get available preset configurations for transfer analysis.
 *
 * @returns List of available presets with descriptions
 */
export async function getTransferPresets(): Promise<TransferPresetInfo[]> {
  return api.get<TransferPresetInfo[]>('/analysis/transfer/presets');
}

/**
 * Get available preprocessing operators for manual selection.
 *
 * @returns List of preprocessing options organized by category
 */
export async function getPreprocessingOptions(): Promise<PreprocessingOptionInfo[]> {
  return api.get<PreprocessingOptionInfo[]>('/analysis/transfer/preprocessing-options');
}
