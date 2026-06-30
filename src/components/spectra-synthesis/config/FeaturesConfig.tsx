/**
 * FeaturesConfig - Advanced configuration panel for with_features() step
 *
 * Provides detailed scientific control over synthetic spectra generation:
 * - Wavelength configuration
 * - Chemical components selection
 * - Physics parameters (baseline, scatter, noise)
 * - Instrument simulation
 * - Measurement mode
 */

import { useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";
import {
  buildComplexityPatch,
  buildCustomModePatch,
  buildNullableSelectPatch,
  buildWavelengthEndPatch,
  buildWavelengthRangePatch,
  buildWavelengthStartPatch,
  getSelectedComponentBadges,
  projectFeaturesParams,
} from "./FeaturesConfigData";
import {
  ChemicalComponentsSection,
  ComplexityPresetControl,
  FeaturesConfigHeader,
  InstrumentSimulationSection,
  PhysicsParametersSections,
  WavelengthConfigSection,
} from "./FeaturesConfigSections";

interface FeaturesConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function FeaturesConfig({
  params,
  onChange,
}: FeaturesConfigProps) {
  const features = projectFeaturesParams(params);
  const selectedComponentBadges = getSelectedComponentBadges(features.components);

  // Apply complexity preset
  const handleComplexityChange = useCallback(
    (value: string) => {
      onChange(buildComplexityPatch(value));
    },
    [onChange]
  );

  const handleWavelengthRangeChange = (values: number[]) => {
    onChange(buildWavelengthRangePatch(values));
  };

  const handleWavelengthStartChange = (value: string) => {
    onChange(buildWavelengthStartPatch(value, features.wavelengthRange));
  };

  const handleWavelengthEndChange = (value: string) => {
    onChange(buildWavelengthEndPatch(value, features.wavelengthRange));
  };

  const handleCustomModeChange = (paramName: string, value: number) => {
    onChange(buildCustomModePatch(paramName, value));
  };

  const handleComponentToggle = (componentName: string) => {
    const newComponents = features.components.includes(componentName)
      ? features.components.filter((c) => c !== componentName)
      : [...features.components, componentName];
    onChange({ components: newComponents });
  };

  const handleRemoveComponent = (componentName: string) => {
    onChange({ components: features.components.filter((c) => c !== componentName) });
  };

  return (
    <div className="space-y-4">
      <FeaturesConfigHeader />

      <Separator />

      <WavelengthConfigSection
        wavelengthRange={features.wavelengthRange}
        wavelengthStep={features.wavelengthStep}
        numWavelengths={features.numWavelengths}
        onRangeChange={handleWavelengthRangeChange}
        onStartChange={handleWavelengthStartChange}
        onEndChange={handleWavelengthEndChange}
        onStepChange={(v) => onChange({ wavelength_step: v })}
      />

      <Separator />

      <ChemicalComponentsSection
        components={features.components}
        selectedComponentBadges={selectedComponentBadges}
        onToggleComponent={handleComponentToggle}
        onRemoveComponent={handleRemoveComponent}
      />

      <Separator />

      <ComplexityPresetControl
        complexity={features.complexity}
        onComplexityChange={handleComplexityChange}
      />

      <Separator />

      <PhysicsParametersSections
        model={features}
        onPathLengthStdChange={(v) => handleCustomModeChange("path_length_std", v)}
        onBaselineAmplitudeChange={(v) => handleCustomModeChange("baseline_amplitude", v)}
        onTiltStdChange={(v) => handleCustomModeChange("tilt_std", v)}
        onGlobalSlopeMeanChange={(v) => handleCustomModeChange("global_slope_mean", v)}
        onGlobalSlopeStdChange={(v) => handleCustomModeChange("global_slope_std", v)}
        onScatterAlphaStdChange={(v) => handleCustomModeChange("scatter_alpha_std", v)}
        onScatterBetaStdChange={(v) => handleCustomModeChange("scatter_beta_std", v)}
        onShiftStdChange={(v) => handleCustomModeChange("shift_std", v)}
        onStretchStdChange={(v) => handleCustomModeChange("stretch_std", v)}
        onNoiseBaseChange={(v) => handleCustomModeChange("noise_base", v)}
        onNoiseSignalDepChange={(v) => handleCustomModeChange("noise_signal_dep", v)}
        onArtifactProbChange={(v) => handleCustomModeChange("artifact_prob", v)}
        onInstrumentalFwhmChange={(v) => handleCustomModeChange("instrumental_fwhm", v)}
      />

      <Separator />

      <InstrumentSimulationSection
        instrumentSelectValue={features.instrumentSelectValue}
        measurementModeSelectValue={features.measurementModeSelectValue}
        onInstrumentChange={(v) => onChange(buildNullableSelectPatch("instrument", v))}
        onMeasurementModeChange={(v) => onChange(buildNullableSelectPatch("measurement_mode", v))}
      />
    </div>
  );
}
