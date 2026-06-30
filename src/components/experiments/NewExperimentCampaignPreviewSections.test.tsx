/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  NewExperimentCampaignDatasetInputsSection,
  NewExperimentCampaignPipelineInputsSection,
} from "./NewExperimentCampaignInputSections";
import { NewExperimentCampaignCapabilitySection } from "./NewExperimentCampaignCapabilitySection";
import { NewExperimentCampaignNoticesSection } from "./NewExperimentCampaignNoticesSection";
import { NewExperimentCampaignRunSection } from "./NewExperimentCampaignRunSection";
import {
  buildCampaignCapabilityCheck,
  buildCampaignDatasetPreviewEntry,
  buildCampaignPipelinePreviewEntry,
  buildCampaignPreviewNotice,
  buildCampaignRunPreviewEntry,
  cleanupPreviews,
  renderPreview,
} from "./newExperimentCampaignPreviewTestUtils";

afterEach(cleanupPreviews);

describe("NewExperimentCampaignDatasetInputsSection", () => {
  it("renders nothing when there are no previews and no hidden entries", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetInputsSection
        datasetPreviews={[]}
        hiddenDatasetPreviewCount={0}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders title and dataset cards", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetInputsSection
        datasetPreviews={[
          buildCampaignDatasetPreviewEntry({ id: "d1", label: "Corn" }),
          buildCampaignDatasetPreviewEntry({ id: "d2", label: "Wheat" }),
        ]}
        hiddenDatasetPreviewCount={0}
      />,
    );

    expect(container.textContent).toContain("Dataset Inputs");
    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("Wheat");
    expect(container.textContent).not.toContain("more dataset inputs");
  });

  it("renders the hidden count when only hidden datasets remain", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetInputsSection
        datasetPreviews={[]}
        hiddenDatasetPreviewCount={3}
      />,
    );

    expect(container.textContent).toContain("Dataset Inputs");
    expect(container.textContent).toContain("+ 3 more dataset inputs");
  });

  it("renders a group_by tag from the dataset split grouping", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignDatasetInputsSection
        datasetPreviews={[
          buildCampaignDatasetPreviewEntry({ splitGroupBy: "batch" }),
        ]}
        hiddenDatasetPreviewCount={0}
      />,
    );

    expect(container.textContent).toContain("group_by: batch");
  });
});

describe("NewExperimentCampaignPipelineInputsSection", () => {
  it("renders nothing when empty", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignPipelineInputsSection
        pipelinePreviews={[]}
        hiddenPipelinePreviewCount={0}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders title, source labels, and hidden count", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignPipelineInputsSection
        pipelinePreviews={[
          buildCampaignPipelinePreviewEntry({ id: "p1", label: "PLS", sourceLabel: "Saved pipeline" }),
        ]}
        hiddenPipelinePreviewCount={2}
      />,
    );

    expect(container.textContent).toContain("Pipeline Inputs");
    expect(container.textContent).toContain("PLS");
    expect(container.textContent).toContain("Saved pipeline");
    expect(container.textContent).toContain("+ 2 more pipeline inputs");
  });
});

describe("NewExperimentCampaignRunSection", () => {
  it("renders nothing when there are no runs and no hidden runs", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunSection runPreviews={[]} hiddenRunCount={0} />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders title, run cards, and hidden run count", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunSection
        runPreviews={[buildCampaignRunPreviewEntry({ positionLabel: "Run 1" })]}
        hiddenRunCount={2}
      />,
    );

    expect(container.textContent).toContain("Planned Runs");
    expect(container.textContent).toContain("Run 1");
    expect(container.textContent).toContain("Corn -> PLS");
    expect(container.textContent).toContain("+ 2 more planned runs");
  });

  it("renders only the hidden run count when previews are fully collapsed", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignRunSection runPreviews={[]} hiddenRunCount={5} />,
    );

    expect(container.textContent).toContain("Planned Runs");
    expect(container.textContent).toContain("+ 5 more planned runs");
    expect(container.textContent).not.toContain("Run 1");
  });
});

describe("NewExperimentCampaignCapabilitySection", () => {
  it("renders nothing when there are no capability checks", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignCapabilitySection capabilityChecks={[]} />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders the readiness title and each capability check", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignCapabilitySection
        capabilityChecks={[
          buildCampaignCapabilityCheck({
            id: "schema-binding",
            title: "Campaign schema binding",
            statusLabel: "Needs attention",
          }),
          buildCampaignCapabilityCheck({
            id: "backend",
            title: "Execution backend capabilities",
            status: "passed",
            statusLabel: "Ready",
            message: "Local Python execution is available.",
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("Readiness Checks");
    expect(container.textContent).toContain("Campaign schema binding");
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("Execution backend capabilities");
    expect(container.textContent).toContain("Local Python execution is available.");
  });
});

describe("NewExperimentCampaignNoticesSection", () => {
  it("renders nothing when there are no notices", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignNoticesSection notices={[]} />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders each notice with severity, title, and message", async () => {
    const { container } = await renderPreview(
      <NewExperimentCampaignNoticesSection
        notices={[
          buildCampaignPreviewNotice({
            id: "cartesian",
            severity: "info",
            title: "Cartesian campaign",
          }),
          buildCampaignPreviewNotice({
            id: "blocking",
            severity: "blocking",
            title: "No runnable pairs",
            message: "Select at least one dataset and pipeline.",
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("Cartesian campaign");
    expect(container.textContent).toContain("info");
    expect(container.textContent).toContain("No runnable pairs");
    expect(container.textContent).toContain("blocking");
    expect(container.textContent).toContain("Select at least one dataset and pipeline.");
  });
});
