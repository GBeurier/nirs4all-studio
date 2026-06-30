import { CHEMICAL_COMPONENTS } from "../definitions";
import type { ChemicalComponent, Complexity } from "../types";

export type WavelengthRange = [number, number];
export type FeaturesComplexity = Complexity | "custom";
export type FeaturesParamsPatch = Record<string, unknown>;

export interface ComplexityPresetPatch {
  path_length_std: number;
  baseline_amplitude: number;
  scatter_alpha_std: number;
  scatter_beta_std: number;
  tilt_std: number;
  global_slope_mean: number;
  global_slope_std: number;
  shift_std: number;
  stretch_std: number;
  instrumental_fwhm: number;
  noise_base: number;
  noise_signal_dep: number;
  artifact_prob: number;
}

export interface FeaturesReadModel {
  wavelengthRange: WavelengthRange;
  wavelengthStep: number;
  complexity: string;
  components: string[];
  pathLengthStd: number;
  baselineAmplitude: number;
  scatterAlphaStd: number;
  scatterBetaStd: number;
  tiltStd: number;
  globalSlopeMean: number;
  globalSlopeStd: number;
  shiftStd: number;
  stretchStd: number;
  instrumentalFwhm: number;
  noiseBase: number;
  noiseSignalDep: number;
  artifactProb: number;
  instrument: string | null;
  measurementMode: string | null;
  instrumentSelectValue: string;
  measurementModeSelectValue: string;
  numWavelengths: number;
}

export interface SelectedComponentBadge {
  name: string;
  label: string;
}

const DEFAULT_WAVELENGTH_RANGE: WavelengthRange = [1000, 2500];
const DEFAULT_COMPONENTS = ["water", "protein", "lipid"];

export const COMPLEXITY_PRESETS = {
  simple: {
    path_length_std: 0.02,
    baseline_amplitude: 0.01,
    scatter_alpha_std: 0.02,
    scatter_beta_std: 0.005,
    tilt_std: 0.005,
    global_slope_mean: 0.0,
    global_slope_std: 0.02,
    shift_std: 0.2,
    stretch_std: 0.0005,
    instrumental_fwhm: 4,
    noise_base: 0.002,
    noise_signal_dep: 0.005,
    artifact_prob: 0.0,
  },
  realistic: {
    path_length_std: 0.05,
    baseline_amplitude: 0.02,
    scatter_alpha_std: 0.05,
    scatter_beta_std: 0.01,
    tilt_std: 0.01,
    global_slope_mean: 0.05,
    global_slope_std: 0.03,
    shift_std: 0.5,
    stretch_std: 0.001,
    instrumental_fwhm: 8,
    noise_base: 0.005,
    noise_signal_dep: 0.01,
    artifact_prob: 0.02,
  },
  complex: {
    path_length_std: 0.08,
    baseline_amplitude: 0.05,
    scatter_alpha_std: 0.08,
    scatter_beta_std: 0.02,
    tilt_std: 0.02,
    global_slope_mean: 0.08,
    global_slope_std: 0.05,
    shift_std: 1.0,
    stretch_std: 0.002,
    instrumental_fwhm: 12,
    noise_base: 0.008,
    noise_signal_dep: 0.015,
    artifact_prob: 0.05,
  },
} satisfies Record<Complexity, ComplexityPresetPatch>;

export function calculateWavelengthPointCount(
  wavelengthRange: WavelengthRange,
  wavelengthStep: number,
): number {
  return Math.floor((wavelengthRange[1] - wavelengthRange[0]) / wavelengthStep) + 1;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function nullableStringParam(value: unknown): string | null {
  return typeof value === "string" || value === null ? value : null;
}

export function coerceWavelengthRange(
  value: unknown,
  fallback: WavelengthRange = DEFAULT_WAVELENGTH_RANGE,
): WavelengthRange {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return [
    numberParam(value[0], fallback[0]),
    numberParam(value[1], fallback[1]),
  ];
}

export function buildWavelengthRangePatch(values: readonly unknown[]): FeaturesParamsPatch {
  return { wavelength_range: coerceWavelengthRange(values) };
}

function parseWavelengthInput(value: string, fallback: number): number {
  return Number.parseInt(value, 10) || fallback;
}

export function buildWavelengthStartPatch(
  value: string,
  currentRange: WavelengthRange,
): FeaturesParamsPatch {
  return {
    wavelength_range: [parseWavelengthInput(value, 350), currentRange[1]],
  };
}

export function buildWavelengthEndPatch(
  value: string,
  currentRange: WavelengthRange,
): FeaturesParamsPatch {
  return {
    wavelength_range: [currentRange[0], parseWavelengthInput(value, 3000)],
  };
}

export function normalizeNullableSelectValue(value: string | null | undefined): string {
  return value || "none";
}

export function buildNullableSelectPatch(
  paramName: string,
  selectValue: string,
): FeaturesParamsPatch {
  return { [paramName]: selectValue === "none" ? null : selectValue };
}

export function buildComplexityPatch(value: string): FeaturesParamsPatch {
  if (value === "custom") {
    return { complexity: value };
  }

  if (value in COMPLEXITY_PRESETS) {
    const preset = COMPLEXITY_PRESETS[value as Complexity];
    return {
      complexity: value,
      ...preset,
    };
  }

  return { complexity: value };
}

export function buildCustomModePatch(paramName: string, value: unknown): FeaturesParamsPatch {
  return {
    [paramName]: value,
    complexity: "custom",
  };
}

export function groupChemicalComponents(
  components: readonly ChemicalComponent[] = CHEMICAL_COMPONENTS,
): Record<string, ChemicalComponent[]> {
  const groups: Record<string, ChemicalComponent[]> = {};

  for (const component of components) {
    if (!groups[component.category]) {
      groups[component.category] = [];
    }
    groups[component.category].push(component);
  }

  return groups;
}

export const CHEMICAL_COMPONENT_GROUPS = groupChemicalComponents();

export function formatComponentCategoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function getComponentBadgeLabel(
  componentName: string,
  components: readonly ChemicalComponent[] = CHEMICAL_COMPONENTS,
): string {
  return components.find((component) => component.name === componentName)?.displayName ?? componentName;
}

export function getSelectedComponentBadges(
  componentNames: readonly string[],
  components: readonly ChemicalComponent[] = CHEMICAL_COMPONENTS,
): SelectedComponentBadge[] {
  return componentNames.map((name) => ({
    name,
    label: getComponentBadgeLabel(name, components),
  }));
}

export function projectFeaturesParams(params: Record<string, unknown>): FeaturesReadModel {
  const wavelengthRange = coerceWavelengthRange(params.wavelength_range);
  const wavelengthStep = numberParam(params.wavelength_step, 2.0);
  const instrument = nullableStringParam(params.instrument);
  const measurementMode = nullableStringParam(params.measurement_mode);

  return {
    wavelengthRange,
    wavelengthStep,
    complexity: stringParam(params.complexity, "custom"),
    components: Array.isArray(params.components)
      ? params.components.filter((component): component is string => typeof component === "string")
      : [...DEFAULT_COMPONENTS],
    pathLengthStd: numberParam(params.path_length_std, 0.05),
    baselineAmplitude: numberParam(params.baseline_amplitude, 0.02),
    scatterAlphaStd: numberParam(params.scatter_alpha_std, 0.05),
    scatterBetaStd: numberParam(params.scatter_beta_std, 0.01),
    tiltStd: numberParam(params.tilt_std, 0.01),
    globalSlopeMean: numberParam(params.global_slope_mean, 0.05),
    globalSlopeStd: numberParam(params.global_slope_std, 0.03),
    shiftStd: numberParam(params.shift_std, 0.5),
    stretchStd: numberParam(params.stretch_std, 0.001),
    instrumentalFwhm: numberParam(params.instrumental_fwhm, 8),
    noiseBase: numberParam(params.noise_base, 0.005),
    noiseSignalDep: numberParam(params.noise_signal_dep, 0.01),
    artifactProb: numberParam(params.artifact_prob, 0.02),
    instrument,
    measurementMode,
    instrumentSelectValue: normalizeNullableSelectValue(instrument),
    measurementModeSelectValue: normalizeNullableSelectValue(measurementMode),
    numWavelengths: calculateWavelengthPointCount(wavelengthRange, wavelengthStep),
  };
}
