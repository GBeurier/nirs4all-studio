/**
 * ValidationMessage Stories
 *
 * Storybook stories for the ValidationMessage shared component.
 * Shows all variants, states, and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ValidationMessage } from "../ValidationMessage";

const meta: Meta<typeof ValidationMessage> = {
  title: "Pipeline Editor/Shared/ValidationMessage",
  component: ValidationMessage,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A component for displaying validation errors, warnings, and info messages with appropriate styling and icons.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    severity: {
      control: "select",
      options: ["error", "warning", "info", "success"],
      description: "Message severity level",
    },
    size: {
      control: "select",
      options: ["sm", "md"],
      description: "Size variant",
    },
    showIcon: {
      control: "boolean",
      description: "Whether to show the severity icon",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Severity Levels
// ============================================================================

export const Error: Story = {
  args: {
    message: "n_components must be at least 1",
    severity: "error",
  },
};

export const Warning: Story = {
  args: {
    message: "n_components is unusually high (>100). Consider reducing to avoid overfitting.",
    severity: "warning",
  },
};

export const Info: Story = {
  args: {
    message: "Using default value of 10 components.",
    severity: "info",
  },
};

// ============================================================================
// Size Variants
// ============================================================================

export const SmallSize: Story = {
  args: {
    message: "Value out of range",
    severity: "error",
    size: "sm",
  },
};

export const MediumSize: Story = {
  args: {
    message: "Value out of range",
    severity: "error",
    size: "md",
  },
};

// ============================================================================
// Icon Options
// ============================================================================

export const WithIcon: Story = {
  args: {
    message: "This parameter is required",
    severity: "error",
    showIcon: true,
  },
};

export const WithoutIcon: Story = {
  args: {
    message: "This parameter is required",
    severity: "error",
    showIcon: false,
  },
};

// ============================================================================
// With Title
// ============================================================================

export const WithTitle: Story = {
  args: {
    message: "Use a value like 0.2 for 20% test split",
    severity: "error",
    title: "test_size must be between 0 and 1",
  },
};

export const WarningWithTitle: Story = {
  args: {
    message: "Consider using RBF kernel for better performance",
    severity: "warning",
    title: "Polynomial kernel may be slow with large datasets",
  },
};

// ============================================================================
// Long Messages
// ============================================================================

export const LongMessage: Story = {
  args: {
    message:
      "The polyorder parameter must be less than the window_length parameter. Currently, polyorder (5) is greater than or equal to window_length (5), which will cause a mathematical error in the Savitzky-Golay filter.",
    severity: "error",
  },
};

export const MultilineWithTitle: Story = {
  args: {
    title: "Model Overfitting Risk",
    message:
      "The model may be overfitting due to the high number of components relative to the number of samples in your training data. Reduce n_components to less than the number of samples, or use cross-validation to find the optimal value.",
    severity: "warning",
  },
};

// ============================================================================
// In Context
// ============================================================================

export const BelowInput: Story = {
  render: () => (
    <div className="space-y-2 w-64">
      <div>
        <label className="text-sm font-medium">n_components</label>
        <input
          type="number"
          defaultValue="0"
          className="w-full mt-1 px-3 py-2 border border-destructive rounded-md font-mono"
        />
      </div>
      <ValidationMessage
        message="Value must be at least 1"
        severity="error"
      />
    </div>
  ),
};

export const MultipleMessages: Story = {
  render: () => (
    <div className="space-y-2 w-80">
      <ValidationMessage
        message="Required parameter is missing"
        severity="error"
      />
      <ValidationMessage
        message="Consider adding cross-validation"
        severity="warning"
      />
      <ValidationMessage
        message="Using default values for optional parameters"
        severity="info"
      />
    </div>
  ),
};

export const InValidationPanel: Story = {
  render: () => (
    <div className="p-4 border rounded-lg space-y-3 w-80">
      <h3 className="font-medium">Validation Issues</h3>
      <div className="space-y-2">
        <ValidationMessage
          message="n_components: Value must be at least 1"
          severity="error"
          size="sm"
        />
        <ValidationMessage
          message="alpha: Value is unusually high. Typical values are between 0.0001 and 1.0"
          severity="warning"
          size="sm"
        />
        <ValidationMessage
          message="No model step in pipeline"
          severity="warning"
          size="sm"
        />
      </div>
    </div>
  ),
};

// ============================================================================
// Success Messages
// ============================================================================

export const Success: Story = {
  args: {
    message: "All parameters are valid",
    severity: "success",
  },
};

export const SuccessWithTitle: Story = {
  args: {
    title: "Validation Complete",
    message: "The pipeline configuration is valid and ready to run.",
    severity: "success",
  },
};
