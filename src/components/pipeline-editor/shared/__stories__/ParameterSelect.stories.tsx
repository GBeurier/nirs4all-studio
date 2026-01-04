/**
 * ParameterSelect Stories
 *
 * Storybook stories for the ParameterSelect shared component.
 * Shows all variants, states, and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParameterSelect } from "../ParameterSelect";

const meta = {
  title: "Pipeline Editor/Shared/ParameterSelect",
  component: ParameterSelect,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A reusable select component for parameter options with label, tooltip, and sweep indicator. Used for parameters with predefined choices.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md"],
      description: "Size variant",
    },
    hasSweep: {
      control: "boolean",
      description: "Whether this parameter has an active sweep",
    },
    disabled: {
      control: "boolean",
      description: "Whether the select is disabled",
    },
    showLabel: {
      control: "boolean",
      description: "Whether to show the label",
    },
  },
} satisfies Meta<typeof ParameterSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    paramKey: "kernel",
    value: "rbf",
    options: [
      { value: "linear", label: "Linear" },
      { value: "rbf", label: "RBF" },
      { value: "poly", label: "Polynomial" },
      { value: "sigmoid", label: "Sigmoid" },
    ],
    onChange: () => {},
    tooltip: "Kernel type for SVM classifier",
  },
};

export const WithSimpleOptions: Story = {
  args: {
    paramKey: "method",
    value: "mean",
    options: [
      { value: "mean", label: "Mean" },
      { value: "median", label: "Median" },
      { value: "mode", label: "Mode" },
    ],
    onChange: () => {},
    tooltip: "Aggregation method",
  },
};

// ============================================================================
// Size Variants
// ============================================================================

export const SmallSize: Story = {
  args: {
    paramKey: "solver",
    value: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "svd", label: "SVD" },
      { value: "lsqr", label: "LSQR" },
    ],
    onChange: () => {},
    size: "sm",
    tooltip: "Solver algorithm",
  },
};

// ============================================================================
// Sweep State
// ============================================================================

export const WithSweep: Story = {
  args: {
    paramKey: "kernel",
    value: "rbf",
    options: [
      { value: "linear", label: "Linear" },
      { value: "rbf", label: "RBF" },
      { value: "poly", label: "Polynomial" },
    ],
    onChange: () => {},
    hasSweep: true,
    tooltip: "This parameter is being swept",
  },
  parameters: {
    docs: {
      description: {
        story: "When a parameter has an active sweep, it shows a badge and the select is disabled.",
      },
    },
  },
};

// ============================================================================
// Validation States
// ============================================================================

export const WithError: Story = {
  args: {
    paramKey: "kernel",
    value: "",
    options: [
      { value: "linear", label: "Linear" },
      { value: "rbf", label: "RBF" },
    ],
    onChange: () => {},
    error: "Selection is required",
    tooltip: "Kernel type",
  },
  parameters: {
    docs: {
      description: {
        story: "Shows error state with red border and error message.",
      },
    },
  },
};

// ============================================================================
// Other States
// ============================================================================

export const Disabled: Story = {
  args: {
    paramKey: "backend",
    value: "cpu",
    options: [
      { value: "cpu", label: "CPU" },
      { value: "gpu", label: "GPU (locked)" },
    ],
    onChange: () => {},
    disabled: true,
    tooltip: "Computation backend (locked)",
  },
};

export const WithoutLabel: Story = {
  args: {
    paramKey: "kernel",
    value: "rbf",
    options: [
      { value: "linear", label: "Linear" },
      { value: "rbf", label: "RBF" },
    ],
    onChange: () => {},
    showLabel: false,
  },
};

export const CustomLabel: Story = {
  args: {
    paramKey: "kernel_type",
    value: "rbf",
    options: [
      { value: "linear", label: "Linear" },
      { value: "rbf", label: "Radial Basis Function" },
    ],
    onChange: () => {},
    label: "SVM Kernel",
    tooltip: "Custom label override",
  },
};

// ============================================================================
// Many Options
// ============================================================================

export const ManyOptions: Story = {
  args: {
    paramKey: "preprocessing",
    value: "standard",
    options: [
      { value: "none", label: "None" },
      { value: "standard", label: "Standard Scaler" },
      { value: "minmax", label: "Min-Max Scaler" },
      { value: "robust", label: "Robust Scaler" },
      { value: "maxabs", label: "Max-Abs Scaler" },
      { value: "normalizer", label: "Normalizer" },
      { value: "quantile", label: "Quantile Transformer" },
      { value: "power", label: "Power Transformer" },
    ],
    onChange: () => {},
    tooltip: "Preprocessing method to apply",
  },
};

// ============================================================================
// With Placeholder
// ============================================================================

export const WithPlaceholder: Story = {
  args: {
    paramKey: "metric",
    value: "",
    options: [
      { value: "rmse", label: "RMSE" },
      { value: "mae", label: "MAE" },
      { value: "r2", label: "R²" },
    ],
    onChange: () => {},
    placeholder: "Select a metric...",
    tooltip: "Evaluation metric",
  },
};
