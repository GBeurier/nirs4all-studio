/**
 * InfoTooltip Stories
 *
 * Storybook stories for the InfoTooltip shared component.
 * Shows all variants and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoTooltip } from "../InfoTooltip";

const meta = {
  title: "Pipeline Editor/Shared/InfoTooltip",
  component: InfoTooltip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A small info icon that displays a tooltip on hover. Used to provide contextual help for parameters and options.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    content: {
      control: "text",
      description: "Tooltip content (text or JSX)",
    },
    side: {
      control: "select",
      options: ["top", "right", "bottom", "left"],
      description: "Preferred side for tooltip placement",
    },
    iconSize: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Icon size",
    },
  },
} satisfies Meta<typeof InfoTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    content: "This is helpful information about a parameter.",
  },
};

export const LongContent: Story = {
  args: {
    content:
      "The number of components to keep for PLS regression. Higher values capture more variance but may lead to overfitting. Typical values range from 5 to 20 for spectroscopic data.",
  },
};

// ============================================================================
// Tooltip Placement
// ============================================================================

export const TopPlacement: Story = {
  args: {
    content: "Tooltip appears above",
    side: "top",
  },
};

export const RightPlacement: Story = {
  args: {
    content: "Tooltip appears to the right",
    side: "right",
  },
};

export const BottomPlacement: Story = {
  args: {
    content: "Tooltip appears below",
    side: "bottom",
  },
};

export const LeftPlacement: Story = {
  args: {
    content: "Tooltip appears to the left",
    side: "left",
  },
};

// ============================================================================
// Size Variants
// ============================================================================

export const SmallSize: Story = {
  args: {
    content: "Smaller icon for compact layouts",
    iconSize: "sm",
  },
};

export const MediumSize: Story = {
  args: {
    content: "Default medium size icon",
    iconSize: "md",
  },
};

export const LargeSize: Story = {
  args: {
    content: "Larger icon for emphasis",
    iconSize: "lg",
  },
};

// ============================================================================
// In Context
// ============================================================================

export const WithLabel: Story = {
  args: {
    content: "Number of PLS components to use in the model",
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium">n_components</label>
      <InfoTooltip {...args} />
    </div>
  ),
};

export const InParameterRow: Story = {
  args: {
    content: "Regularization strength. Must be a positive float.",
  },
  render: (args) => (
    <div className="space-y-2 w-64">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Alpha</label>
        <InfoTooltip {...args} />
      </div>
      <input
        type="number"
        defaultValue="0.1"
        className="w-full px-3 py-2 border rounded-md font-mono"
      />
    </div>
  ),
};

export const MultipleTooltips: Story = {
  args: {
    content: "Step size for gradient descent optimization",
  },
  render: () => (
    <div className="space-y-4 w-64">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Learning Rate</label>
        <InfoTooltip content="Step size for gradient descent optimization" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Epochs</label>
        <InfoTooltip content="Number of complete passes through the training data" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Batch Size</label>
        <InfoTooltip content="Number of samples per gradient update" />
      </div>
    </div>
  ),
};

// ============================================================================
// Rich Content
// ============================================================================

export const WithFormattedContent: Story = {
  args: {
    content: (
      <div className="space-y-2">
        <p className="font-medium">PLS Components</p>
        <p className="text-xs">Controls model complexity.</p>
        <ul className="text-xs list-disc list-inside">
          <li>Low (1-5): Underfitting risk</li>
          <li>Medium (5-15): Recommended</li>
          <li>High (&gt;15): Overfitting risk</li>
        </ul>
      </div>
    ),
  },
};

export const WithCodeExample: Story = {
  args: {
    content: (
      <div className="space-y-2">
        <p>Python equivalent:</p>
        <code className="block text-xs bg-muted px-2 py-1 rounded">
          PLSRegression(n_components=10)
        </code>
      </div>
    ),
  },
};
