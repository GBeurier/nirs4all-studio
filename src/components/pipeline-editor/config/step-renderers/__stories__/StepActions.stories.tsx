/**
 * StepActions Component Stories
 *
 * Storybook stories for the StepActions component.
 * Demonstrates action buttons for step configuration panels.
 *
 * Phase 6 Implementation - Storybook Setup
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepActions } from "../StepActions";

// Action handlers that log to console for demonstration
const onDuplicate = (id: string) => console.log("Duplicate:", id);
const onRemove = (id: string) => console.log("Remove:", id);

const meta: Meta<typeof StepActions> = {
  title: "Pipeline Editor/Step Renderers/StepActions",
  component: StepActions,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    stepId: "step-1",
    onDuplicate,
    onRemove,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    stepId: "step-1",
  },
};

export const WithCustomWidth: Story = {
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: {
    stepId: "step-2",
  },
};

export const NarrowContainer: Story = {
  decorators: [
    (Story) => (
      <div className="w-48">
        <Story />
      </div>
    ),
  ],
  args: {
    stepId: "step-3",
  },
};

// ============================================================================
// In Context
// ============================================================================

export const InPanel: Story = {
  render: () => (
    <div className="w-80 border rounded-lg bg-background">
      <div className="p-4 border-b">
        <h3 className="font-medium">Step Configuration</h3>
        <p className="text-sm text-muted-foreground">MinMaxScaler</p>
      </div>
      <div className="p-4">
        <p className="text-sm text-muted-foreground">
          (Parameters would go here)
        </p>
      </div>
      <StepActions
        stepId="step-panel"
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  ),
};

export const MultiplePanels: Story = {
  render: () => (
    <div className="flex gap-4">
      <div className="w-64 border rounded-lg bg-background">
        <div className="p-4 border-b">
          <h3 className="font-medium text-sm">Preprocessing</h3>
        </div>
        <StepActions
          stepId="step-1"
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>
      <div className="w-64 border rounded-lg bg-background">
        <div className="p-4 border-b">
          <h3 className="font-medium text-sm">Model</h3>
        </div>
        <StepActions
          stepId="step-2"
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>
    </div>
  ),
};

// ============================================================================
// Dark Theme Preview
// ============================================================================

export const DarkTheme: Story = {
  decorators: [
    (Story) => (
      <div className="dark bg-slate-900 p-6 rounded-lg">
        <div className="w-80 border border-slate-700 rounded-lg bg-slate-800">
          <div className="p-4 border-b border-slate-700">
            <h3 className="font-medium text-white">Step Configuration</h3>
          </div>
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    stepId: "step-dark",
  },
};
