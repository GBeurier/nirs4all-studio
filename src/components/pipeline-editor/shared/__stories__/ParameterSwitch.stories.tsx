/**
 * ParameterSwitch Stories
 *
 * Storybook stories for the ParameterSwitch shared component.
 * Shows all variants, states, and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParameterSwitch } from "../ParameterSwitch";

const meta = {
  title: "Pipeline Editor/Shared/ParameterSwitch",
  component: ParameterSwitch,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A reusable switch component for boolean parameters with label and tooltip. Used for on/off toggles in step configuration.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    checked: {
      control: "boolean",
      description: "Current toggle state",
    },
    disabled: {
      control: "boolean",
      description: "Whether the switch is disabled",
    },
  },
} satisfies Meta<typeof ParameterSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    paramKey: "normalize",
    checked: false,
    onChange: () => {},
    tooltip: "Whether to normalize the input data",
  },
};

export const Checked: Story = {
  args: {
    paramKey: "normalize",
    checked: true,
    onChange: () => {},
    tooltip: "Normalization is enabled",
  },
};

// ============================================================================
// With Description
// ============================================================================

export const WithDescription: Story = {
  args: {
    paramKey: "fit_intercept",
    checked: true,
    onChange: () => {},
    description: "Calculate the intercept for this model",
    tooltip: "Whether to calculate the intercept for this model",
  },
};

// ============================================================================
// Other States
// ============================================================================

export const Disabled: Story = {
  args: {
    paramKey: "use_gpu",
    checked: false,
    onChange: () => {},
    disabled: true,
    tooltip: "GPU acceleration (not available)",
  },
};

export const DisabledChecked: Story = {
  args: {
    paramKey: "required_option",
    checked: true,
    onChange: () => {},
    disabled: true,
    tooltip: "This option cannot be changed",
  },
};

export const CustomLabel: Story = {
  args: {
    paramKey: "use_scaling",
    checked: true,
    onChange: () => {},
    label: "Enable Automatic Scaling",
    tooltip: "Custom label override",
  },
};

// ============================================================================
// Common Use Cases
// ============================================================================

export const NormalizeInput: Story = {
  args: {
    paramKey: "normalize",
    checked: true,
    onChange: () => {},
    tooltip: "Apply L2 normalization to input samples",
    label: "Normalize inputs",
  },
};

export const CenterData: Story = {
  args: {
    paramKey: "center",
    checked: true,
    onChange: () => {},
    tooltip: "Center data before PLS decomposition",
    label: "Center data",
  },
};

export const ShuffleData: Story = {
  args: {
    paramKey: "shuffle",
    checked: true,
    onChange: () => {},
    tooltip: "Shuffle the data before splitting into batches",
    label: "Shuffle data",
  },
};

export const VerboseMode: Story = {
  args: {
    paramKey: "verbose",
    checked: false,
    onChange: () => {},
    tooltip: "Enable verbose output during training",
    label: "Verbose output",
  },
};
