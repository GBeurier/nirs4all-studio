/**
 * ParameterInput Stories
 *
 * Storybook stories for the ParameterInput shared component.
 * Shows all variants, states, and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParameterInput } from "../ParameterInput";

const meta = {
  title: "Pipeline Editor/Shared/ParameterInput",
  component: ParameterInput,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A reusable parameter input component with label, tooltip, sweep indicator, and validation states. Used throughout the pipeline editor for step configuration.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: "text",
      description: "Current parameter value (string or number)",
    },
    type: {
      control: "select",
      options: ["text", "number"],
      description: "Input type (auto-detected from value type if not provided)",
    },
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
      description: "Whether the input is disabled",
    },
    showLabel: {
      control: "boolean",
      description: "Whether to show the label",
    },
  },
} satisfies Meta<typeof ParameterInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    paramKey: "n_components",
    value: 10,
    onChange: () => {},
    tooltip: "Number of PLS components to use",
  },
};

export const WithTextValue: Story = {
  args: {
    paramKey: "kernel",
    value: "rbf",
    onChange: () => {},
    tooltip: "Kernel type for SVM",
  },
};

export const WithoutLabel: Story = {
  args: {
    paramKey: "alpha",
    value: 0.5,
    onChange: () => {},
    showLabel: false,
  },
};

// ============================================================================
// Size Variants
// ============================================================================

export const SmallSize: Story = {
  args: {
    paramKey: "alpha",
    value: 0.01,
    onChange: () => {},
    size: "sm",
    tooltip: "Regularization strength",
  },
};

export const MediumSize: Story = {
  args: {
    paramKey: "max_iter",
    value: 1000,
    onChange: () => {},
    size: "md",
    tooltip: "Maximum number of iterations",
  },
};

// ============================================================================
// Sweep State
// ============================================================================

export const WithSweep: Story = {
  args: {
    paramKey: "n_components",
    value: 10,
    onChange: () => {},
    hasSweep: true,
    tooltip: "This parameter is being swept",
  },
  parameters: {
    docs: {
      description: {
        story: "When a parameter has an active sweep, it shows a badge and the input is disabled.",
      },
    },
  },
};

// ============================================================================
// Validation States
// ============================================================================

export const WithError: Story = {
  args: {
    paramKey: "n_components",
    value: 0,
    onChange: () => {},
    error: "Value must be at least 1",
    tooltip: "Number of components",
  },
  parameters: {
    docs: {
      description: {
        story: "Shows error state with red border and error message.",
      },
    },
  },
};

export const WithWarning: Story = {
  args: {
    paramKey: "n_components",
    value: 150,
    onChange: () => {},
    warning: "Value is unusually high. Consider using fewer components.",
    tooltip: "Number of components",
  },
  parameters: {
    docs: {
      description: {
        story: "Shows warning state with orange border and warning message.",
      },
    },
  },
};

// ============================================================================
// Number Input Options
// ============================================================================

export const WithMinMax: Story = {
  args: {
    paramKey: "test_size",
    value: 0.2,
    onChange: () => {},
    type: "number",
    min: 0.01,
    max: 0.99,
    step: 0.01,
    tooltip: "Proportion of data for testing (0.01 - 0.99)",
  },
};

export const WithCustomStep: Story = {
  args: {
    paramKey: "learning_rate",
    value: 0.001,
    onChange: () => {},
    type: "number",
    step: 0.0001,
    tooltip: "Learning rate with fine-grained step",
  },
};

// ============================================================================
// Disabled State
// ============================================================================

export const Disabled: Story = {
  args: {
    paramKey: "random_state",
    value: 42,
    onChange: () => {},
    disabled: true,
    tooltip: "Random seed (locked)",
  },
};

// ============================================================================
// Custom Label
// ============================================================================

export const CustomLabel: Story = {
  args: {
    paramKey: "n_components",
    value: 10,
    onChange: () => {},
    label: "PLS Components",
    tooltip: "Override the default formatted label",
  },
};

// ============================================================================
// Placeholder
// ============================================================================

export const WithPlaceholder: Story = {
  args: {
    paramKey: "regularization",
    value: "",
    onChange: () => {},
    placeholder: "Enter regularization value...",
    type: "text",
    tooltip: "Optional regularization parameter",
  },
};
