/**
 * Shared Components Demo
 *
 * This file demonstrates the usage of shared components extracted in Phase 1.
 * It serves as both documentation and a visual test for the components.
 *
 * This is NOT imported into the main application - it's a reference implementation
 * showing how to use the shared components when refactoring existing components
 * in Phase 3.
 *
 * @example
 * To use this demo, import it into a page or story:
 * import { SharedComponentsDemo } from "@/components/pipeline-editor/shared/demo";
 */

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  ParameterInput,
  ParameterSelect,
  ParameterSwitch,
  CollapsibleSection,
  InfoTooltip,
  ValidationMessage,
  InlineValidationMessage,
} from "./index";

export function SharedComponentsDemo() {
  // Demo state
  const [numValue, setNumValue] = useState<number>(10);
  const [stringValue, setStringValue] = useState<string>("test");
  const [selectValue, setSelectValue] = useState<string>("rbf");
  const [switchValue, setSwitchValue] = useState<boolean>(true);

  return (
    <div className="p-6 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold mb-2">
          Shared Components Demo
        </h1>
        <p className="text-muted-foreground">
          Phase 1 Foundation - Extracted reusable patterns
        </p>
      </div>

      <Separator />

      {/* InfoTooltip Demo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            InfoTooltip
            <InfoTooltip content="This is the InfoTooltip component" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1">
              Default: <InfoTooltip content="Default tooltip on the left" />
            </span>
            <span className="flex items-center gap-1">
              Right side: <InfoTooltip content="Tooltip on the right" side="right" />
            </span>
            <span className="flex items-center gap-1">
              Small: <InfoTooltip content="Small icon" iconSize="sm" />
            </span>
            <span className="flex items-center gap-1">
              Large: <InfoTooltip content="Large icon" iconSize="lg" />
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ParameterInput Demo */}
      <Card>
        <CardHeader>
          <CardTitle>ParameterInput</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ParameterInput
            paramKey="n_components"
            value={numValue}
            onChange={(v) => setNumValue(v as number)}
            tooltip="Number of PLS components to use"
          />

          <ParameterInput
            paramKey="algorithm_name"
            value={stringValue}
            onChange={(v) => setStringValue(v as string)}
            tooltip="Name of the algorithm"
          />

          <ParameterInput
            paramKey="learning_rate"
            value={0.001}
            onChange={() => {}}
            tooltip="This parameter has a sweep active"
            hasSweep={true}
          />

          <ParameterInput
            paramKey="invalid_param"
            value={-5}
            onChange={() => {}}
            error="Value must be positive"
          />
        </CardContent>
      </Card>

      {/* ParameterSelect Demo */}
      <Card>
        <CardHeader>
          <CardTitle>ParameterSelect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Simple options */}
          <ParameterSelect
            paramKey="kernel"
            value={selectValue}
            onChange={(v) => setSelectValue(v as string)}
            options={["rbf", "linear", "poly", "sigmoid"]}
            tooltip="Kernel type for SVM"
          />

          {/* Rich options with descriptions */}
          <ParameterSelect
            paramKey="activation"
            value="relu"
            onChange={() => {}}
            options={[
              { value: "relu", label: "ReLU", description: "Rectified Linear Unit" },
              { value: "tanh", label: "Tanh", description: "Hyperbolic tangent" },
              { value: "sigmoid", label: "Sigmoid", description: "Logistic function" },
            ]}
            tooltip="Activation function for neural network"
          />

          <ParameterSelect
            paramKey="sweep_kernel"
            value="rbf"
            onChange={() => {}}
            options={["rbf", "linear"]}
            hasSweep={true}
          />
        </CardContent>
      </Card>

      {/* ParameterSwitch Demo */}
      <Card>
        <CardHeader>
          <CardTitle>ParameterSwitch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ParameterSwitch
            paramKey="shuffle"
            checked={switchValue}
            onChange={setSwitchValue}
            tooltip="Whether to shuffle data before splitting"
          />

          <ParameterSwitch
            paramKey="use_cache"
            checked={true}
            onChange={() => {}}
            description="Cache intermediate results for faster re-runs"
          />

          <ParameterSwitch
            paramKey="enabled_feature"
            checked={false}
            onChange={() => {}}
            layout="stacked"
            label="Enable Experimental Feature"
            description="Turn on this experimental feature for testing"
          />

          <ParameterSwitch
            paramKey="sweep_shuffle"
            checked={true}
            onChange={() => {}}
            hasSweep={true}
            tooltip="This switch has a sweep active"
          />
        </CardContent>
      </Card>

      {/* CollapsibleSection Demo */}
      <Card>
        <CardHeader>
          <CardTitle>CollapsibleSection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CollapsibleSection
            title="Advanced Settings"
            icon={<Settings2 className="h-4 w-4" />}
          >
            <div className="p-4 bg-muted rounded-lg">
              <p>This is the advanced settings content.</p>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Open by Default"
            defaultOpen={true}
            variant="outline"
          >
            <div className="p-4">
              <p>This section is open by default.</p>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Small Size"
            size="sm"
          >
            <div className="p-2 text-sm">
              <p>Small section content.</p>
            </div>
          </CollapsibleSection>
        </CardContent>
      </Card>

      {/* ValidationMessage Demo */}
      <Card>
        <CardHeader>
          <CardTitle>ValidationMessage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ValidationMessage
            severity="error"
            message="This pipeline has invalid configuration"
          />

          <ValidationMessage
            severity="warning"
            title="Performance Warning"
            message="This combination may affect training speed"
          />

          <ValidationMessage
            severity="info"
            message="Tip: Use Kennard-Stone for representative sampling"
          />

          <ValidationMessage
            severity="success"
            message="Pipeline validated successfully"
          />

          <div className="flex items-center gap-4">
            <span>Inline:</span>
            <InlineValidationMessage
              severity="error"
              message="Invalid value"
            />
            <InlineValidationMessage
              severity="warning"
              message="Check this"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
