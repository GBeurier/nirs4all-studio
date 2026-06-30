/**
 * Shared test utilities and typed fixtures for the New Experiment campaign
 * preview leaf/section components. These let the component tests assert
 * rendering behaviour in isolation (empty-content hiding, hidden counts,
 * critical labels) without going through the full `buildCampaignPlanPreview`
 * pipeline, which is covered separately by NewExperimentCampaignPlanPreview.test.tsx.
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { CampaignCapabilityCheck } from "@/lib/campaignCapabilityTypes";
import type { CampaignPreviewNotice } from "@/lib/campaignNoticeTypes";
import type {
  CampaignDatasetPreviewEntry,
  CampaignPipelinePreviewEntry,
  CampaignRunPreviewEntry,
} from "@/lib/campaignPlanPreviewTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedContainers: HTMLDivElement[] = [];
const mountedRoots: Root[] = [];

export async function renderPreview(element: ReactNode): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

export async function cleanupPreviews(): Promise<void> {
  await act(async () => {
    for (const root of mountedRoots) {
      root.unmount();
    }
  });
  mountedRoots.length = 0;
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers.length = 0;
}

export function buildCampaignDatasetPreviewEntry(
  overrides: Partial<CampaignDatasetPreviewEntry> = {},
): CampaignDatasetPreviewEntry {
  return {
    id: "d1",
    label: "Corn",
    sampleCountLabel: "42 samples",
    featureCountLabel: "128 features",
    sourceCountLabel: "1 source",
    sourceModeLabel: "single source",
    representationCountLabel: "1 representation",
    dataViewLabel: "Default spectral view",
    dataViewTaskLabel: "regression",
    targetCountLabel: "1 target",
    targetLabel: "protein",
    metadataColumnCountLabel: "1 metadata column",
    repetitionLabel: "no repetition column",
    aggregationLabel: "No aggregation configured",
    aggregationSourceLabel: null,
    splitGroupBy: null,
    ...overrides,
  };
}

export function buildCampaignPipelinePreviewEntry(
  overrides: Partial<CampaignPipelinePreviewEntry> = {},
): CampaignPipelinePreviewEntry {
  return {
    id: "p1",
    label: "PLS",
    sourceLabel: "Saved pipeline",
    stepCountLabel: "2 steps",
    stepSummaryLabel: "SNV → PLS",
    complexityLabels: ["No refit, finetune, sweeps, or generators"],
    ...overrides,
  };
}

export function buildCampaignRunPreviewEntry(
  overrides: Partial<CampaignRunPreviewEntry> = {},
): CampaignRunPreviewEntry {
  return {
    id: "d1::p1",
    datasetId: "d1",
    pipelineId: "p1",
    datasetLabel: "Corn",
    pipelineLabel: "PLS",
    datasetDetailLabels: ["42 samples", "target: protein"],
    pipelineDetailLabels: ["2 steps"],
    compatibilityStatus: "passed",
    compatibilityStatusLabel: "Ready",
    compatibilitySummary: "Schema preview ready for this dataset/pipeline pair.",
    splitGroupBy: null,
    positionLabel: "Run 1",
    ...overrides,
  };
}

export function buildCampaignCapabilityCheck(
  overrides: Partial<CampaignCapabilityCheck> = {},
): CampaignCapabilityCheck {
  return {
    id: "schema-binding",
    status: "warning",
    statusLabel: "Needs attention",
    title: "Campaign schema binding",
    message:
      "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
    ...overrides,
  };
}

export function buildCampaignPreviewNotice(
  overrides: Partial<CampaignPreviewNotice> = {},
): CampaignPreviewNotice {
  return {
    id: "cartesian",
    severity: "info",
    title: "Cartesian campaign",
    message: "Every selected pipeline is paired with every selected dataset.",
    ...overrides,
  };
}
