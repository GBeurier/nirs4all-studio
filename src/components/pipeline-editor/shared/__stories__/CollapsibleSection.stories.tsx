/**
 * CollapsibleSection Stories
 *
 * Storybook stories for the CollapsibleSection shared component.
 * Shows all variants, states, and use cases.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollapsibleSection } from "../CollapsibleSection";

const meta = {
  title: "Pipeline Editor/Shared/CollapsibleSection",
  component: CollapsibleSection,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A collapsible section component for organizing parameter groups. Commonly used to group related parameters or show advanced options.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    defaultOpen: {
      control: "boolean",
      description: "Whether the section is open by default",
    },
    disabled: {
      control: "boolean",
      description: "Whether the section is disabled (cannot be toggled)",
    },
    variant: {
      control: "select",
      options: ["default", "ghost", "outline"],
      description: "Visual style variant",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Size variant",
    },
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Basic Usage
// ============================================================================

export const Default: Story = {
  args: {
    title: "Advanced Options",
    children: (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="option1" />
          <label htmlFor="option1">Enable feature A</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="option2" />
          <label htmlFor="option2">Enable feature B</label>
        </div>
      </div>
    ),
  },
};

export const OpenByDefault: Story = {
  args: {
    title: "Model Parameters",
    defaultOpen: true,
    children: (
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Learning Rate</label>
          <input
            type="number"
            defaultValue="0.001"
            className="w-full mt-1 px-3 py-2 border rounded-md"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Epochs</label>
          <input
            type="number"
            defaultValue="100"
            className="w-full mt-1 px-3 py-2 border rounded-md"
          />
        </div>
      </div>
    ),
  },
};

// ============================================================================
// Variants
// ============================================================================

export const GhostVariant: Story = {
  args: {
    title: "Additional Settings",
    variant: "ghost",
    defaultOpen: true,
    children: (
      <p className="text-sm text-muted-foreground">
        This section has a ghost appearance with no border.
      </p>
    ),
  },
};

export const OutlineVariant: Story = {
  args: {
    title: "Outline Section",
    variant: "outline",
    defaultOpen: true,
    children: (
      <p className="text-sm text-muted-foreground">
        This section has a dashed outline appearance.
      </p>
    ),
  },
};

// ============================================================================
// Size Variants
// ============================================================================

export const SmallSize: Story = {
  args: {
    title: "Compact Section",
    size: "sm",
    defaultOpen: true,
    children: (
      <p className="text-xs text-muted-foreground">
        Small size for compact layouts.
      </p>
    ),
  },
};

// ============================================================================
// With Badge/Count
// ============================================================================

export const WithBadge: Story = {
  args: {
    title: "Parameters",
    badge: "3",
    defaultOpen: true,
    children: (
      <ul className="text-sm space-y-1">
        <li>n_components: 10</li>
        <li>alpha: 0.1</li>
        <li>max_iter: 1000</li>
      </ul>
    ),
  },
};

export const WithStatusBadge: Story = {
  args: {
    title: "Validation",
    badge: <span className="text-destructive">2 errors</span>,
    defaultOpen: true,
    children: (
      <div className="text-sm text-destructive space-y-1">
        <p>• n_components must be at least 1</p>
        <p>• alpha must be positive</p>
      </div>
    ),
  },
};

// ============================================================================
// States
// ============================================================================

export const Disabled: Story = {
  args: {
    title: "Locked Section",
    disabled: true,
    children: (
      <p className="text-sm text-muted-foreground">
        This content cannot be shown.
      </p>
    ),
  },
};

// ============================================================================
// Real-World Examples
// ============================================================================

export const AdvancedModelOptions: Story = {
  args: {
    title: "Advanced Model Options",
    defaultOpen: false,
    children: (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Regularization</label>
          <select className="w-full mt-1 px-3 py-2 border rounded-md">
            <option>L1 (Lasso)</option>
            <option>L2 (Ridge)</option>
            <option>Elastic Net</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Tolerance</label>
          <input
            type="number"
            defaultValue="0.0001"
            step="0.0001"
            className="w-full mt-1 px-3 py-2 border rounded-md font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="warm_start" />
          <label htmlFor="warm_start" className="text-sm">
            Warm start
          </label>
        </div>
      </div>
    ),
  },
};

export const SweepConfiguration: Story = {
  args: {
    title: "Sweep Configuration",
    badge: <span className="text-orange-600">Active</span>,
    defaultOpen: true,
    children: (
      <div className="space-y-3">
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
          <p className="text-sm font-medium text-orange-700">
            n_components: [5, 10, 15, 20]
          </p>
          <p className="text-xs text-orange-600 mt-1">4 values to sweep</p>
        </div>
        <button className="text-sm text-primary hover:underline">
          + Add another sweep
        </button>
      </div>
    ),
  },
};

export const NestedSections: Story = {
  args: {
    title: "Preprocessing Pipeline",
    defaultOpen: true,
    children: (
      <div className="space-y-2">
        <CollapsibleSection title="Normalization" size="sm" defaultOpen={true}>
          <p className="text-xs text-muted-foreground">
            SNV applied to spectra
          </p>
        </CollapsibleSection>
        <CollapsibleSection title="Smoothing" size="sm" defaultOpen={false}>
          <p className="text-xs text-muted-foreground">
            Savitzky-Golay filter
          </p>
        </CollapsibleSection>
        <CollapsibleSection title="Baseline Correction" size="sm" defaultOpen={false}>
          <p className="text-xs text-muted-foreground">Detrend applied</p>
        </CollapsibleSection>
      </div>
    ),
  },
};
