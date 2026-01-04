/**
 * CommentRenderer Component Stories
 *
 * Storybook stories for the CommentRenderer component.
 * Demonstrates comment step configuration for pipeline documentation.
 *
 * Phase 6 Implementation - Storybook Setup
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommentRenderer } from "../CommentRenderer";

// Action handlers that log to console for demonstration
const onUpdate = (id: string, updates: object) => console.log("Update:", id, updates);
const onRemove = (id: string) => console.log("Remove:", id);
const onDuplicate = (id: string) => console.log("Duplicate:", id);

const meta: Meta<typeof CommentRenderer> = {
  title: "Pipeline Editor/Step Renderers/CommentRenderer",
  component: CommentRenderer,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-80 h-[400px] border rounded-lg bg-background flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-medium">Comment Step</h3>
        </div>
        <Story />
      </div>
    ),
  ],
  args: {
    onUpdate,
    onRemove,
    onDuplicate,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Empty: Story = {
  args: {
    step: {
      id: "comment-1",
      type: "comment",
      name: "_comment",
      params: { text: "" },
    },
  },
};

export const WithText: Story = {
  args: {
    step: {
      id: "comment-2",
      type: "comment",
      name: "_comment",
      params: { text: "This preprocessing step normalizes the spectra using SNV." },
    },
  },
};

export const LongComment: Story = {
  args: {
    step: {
      id: "comment-3",
      type: "comment",
      name: "_comment",
      params: {
        text: `This section handles data preprocessing:

1. SNV normalization to remove scatter effects
2. Savitzky-Golay smoothing for noise reduction
3. Feature selection based on VIP scores

Note: The preprocessing order matters - normalization should come before smoothing.`,
      },
    },
  },
};

// ============================================================================
// Real-World Examples
// ============================================================================

export const DataQualityNote: Story = {
  args: {
    step: {
      id: "comment-quality",
      type: "comment",
      name: "_comment",
      params: {
        text: "Data quality check: Remove outliers with Mahalanobis distance > 3",
      },
    },
  },
};

export const ModelExplanation: Story = {
  args: {
    step: {
      id: "comment-model",
      type: "comment",
      name: "_comment",
      params: {
        text: "Using PLS with 10 components based on cross-validation results from 2024-01-15",
      },
    },
  },
};

export const WarningNote: Story = {
  args: {
    step: {
      id: "comment-warning",
      type: "comment",
      name: "_comment",
      params: {
        text: "⚠️ WARNING: This pipeline requires at least 100 samples for reliable prediction",
      },
    },
  },
};
