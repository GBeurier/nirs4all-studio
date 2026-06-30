/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import { NewExperimentCampaignCapabilityCard } from "./NewExperimentCampaignCapabilityCard";
import { NewExperimentCampaignDatasetPreviewCard } from "./NewExperimentCampaignDatasetPreviewCard";
import { NewExperimentCampaignPipelinePreviewCard } from "./NewExperimentCampaignPipelinePreviewCard";
import { NewExperimentCampaignRunPreviewCard } from "./NewExperimentCampaignRunPreviewCard";
import {
  buildCampaignCapabilityCheck,
  buildCampaignDatasetPreviewEntry,
  buildCampaignPipelinePreviewEntry,
  buildCampaignRunPreviewEntry,
  cleanupPreviews,
  renderPreview,
} from "./newExperimentCampaignPreviewTestUtils";

afterEach(cleanupPreviews);

describe("NewExperimentCampaignDatasetPreviewCard", () => {
  it("exposes the dataset label and schema-critical detail labels", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetPreviewCard
        datasetPreview={buildCampaignDatasetPreviewEntry({
          label: "Corn",
          sampleCountLabel: "42 samples",
          targetLabel: "protein",
          dataViewLabel: "Default spectral view",
        })}
      />,
    );

    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("42 samples");
    expect(container.textContent).toContain("target: protein");
    expect(container.textContent).toContain("view: Default spectral view");
    expect(container.textContent).toContain("task: regression");
    expect(container.textContent).toContain("No aggregation configured");
  });

  it("renders a group_by tag and the aggregation source when present", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetPreviewCard
        datasetPreview={buildCampaignDatasetPreviewEntry({
          splitGroupBy: "batch",
          aggregationLabel: "Aggregated by scan_id",
          aggregationSourceLabel: "from repetition column",
        })}
      />,
    );

    expect(container.textContent).toContain("group_by: batch");
    expect(container.textContent).toContain("Aggregated by scan_id");
    expect(container.textContent).toContain("from repetition column");
  });

  it("omits a null aggregation source label", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetPreviewCard
        datasetPreview={buildCampaignDatasetPreviewEntry({ aggregationSourceLabel: null })}
      />,
    );

    expect(container.textContent).not.toContain("from repetition column");
  });
});

describe("NewExperimentCampaignPipelinePreviewCard", () => {
  it("exposes the pipeline label, source tag, and complexity labels", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignPipelinePreviewCard
        pipelinePreview={buildCampaignPipelinePreviewEntry({
          label: "PLS",
          sourceLabel: "Current editor",
          stepCountLabel: "2 steps",
          stepSummaryLabel: "SNV → PLS",
          complexityLabels: ["Includes finetune sweeps"],
        })}
      />,
    );

    expect(container.textContent).toContain("PLS");
    expect(container.textContent).toContain("Current editor");
    expect(container.textContent).toContain("2 steps");
    expect(container.textContent).toContain("SNV → PLS");
    expect(container.textContent).toContain("Includes finetune sweeps");
  });
});

describe("NewExperimentCampaignRunPreviewCard", () => {
  it("exposes the position label, dataset/pipeline pair, and compatibility summary", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunPreviewCard
        runPreview={buildCampaignRunPreviewEntry({
          positionLabel: "Run 1",
          datasetLabel: "Corn",
          pipelineLabel: "PLS",
          compatibilityStatusLabel: "Ready",
          compatibilitySummary: "Schema preview ready for this dataset/pipeline pair.",
        })}
      />,
    );

    expect(container.textContent).toContain("Run 1");
    expect(container.textContent).toContain("Corn -> PLS");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Schema preview ready for this dataset/pipeline pair.");
    expect(container.textContent).toContain("42 samples");
    expect(container.textContent).toContain("target: protein");
  });

  it("renders the group_by tag for grouped runs", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunPreviewCard
        runPreview={buildCampaignRunPreviewEntry({ splitGroupBy: "cluster_id" })}
      />,
    );

    expect(container.textContent).toContain("group_by: cluster_id");
  });

  it("omits the compatibility summary and badge when not evaluated", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunPreviewCard
        runPreview={buildCampaignRunPreviewEntry({
          compatibilityStatus: null,
          compatibilityStatusLabel: null,
          compatibilitySummary: null,
        })}
      />,
    );

    expect(container.textContent).toContain("Corn -> PLS");
    expect(container.textContent).not.toContain("Ready");
    expect(container.textContent).not.toContain("Schema preview ready");
  });
});

describe("NewExperimentCampaignCapabilityCard", () => {
  it("exposes the title, status label, and message", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignCapabilityCard
        check={buildCampaignCapabilityCheck({
          title: "Campaign schema binding",
          statusLabel: "Needs attention",
          message: "Convert the cartesian matrix to explicit pair previews.",
        })}
      />,
    );

    expect(container.textContent).toContain("Campaign schema binding");
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("Convert the cartesian matrix to explicit pair previews.");
  });
});
