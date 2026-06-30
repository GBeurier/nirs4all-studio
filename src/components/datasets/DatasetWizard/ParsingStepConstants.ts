/**
 * Select option lists for the parsing-step forms.
 *
 * Pure presentation data shared by the parsing form, per-file overrides,
 * and the advanced loading options section.
 */
import type { HeaderUnit, SignalType, NaPolicy, NaFillConfig } from "@/types/datasets";

export const DELIMITER_OPTIONS = [
  { value: ";", label: "Semicolon (;)" },
  { value: ",", label: "Comma (,)" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe (|)" },
  { value: " ", label: "Space" },
];

export const DECIMAL_OPTIONS = [
  { value: ".", label: "Dot (.)" },
  { value: ",", label: "Comma (,)" },
];

export const HEADER_UNIT_OPTIONS: { value: HeaderUnit; label: string }[] = [
  { value: "nm", label: "Wavelength (nm)" },
  { value: "cm-1", label: "Wavenumber (cm⁻¹)" },
  { value: "text", label: "Text labels" },
  { value: "index", label: "Numeric index" },
  { value: "none", label: "No header" },
];

export const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "absorbance", label: "Absorbance" },
  { value: "reflectance", label: "Reflectance (0-1)" },
  { value: "reflectance%", label: "Reflectance (%)" },
  { value: "transmittance", label: "Transmittance (0-1)" },
  { value: "transmittance%", label: "Transmittance (%)" },
];

export const NA_POLICY_OPTIONS: { value: NaPolicy; labelKey: string }[] = [
  { value: "auto", labelKey: "settings.dataDefaults.missing.policies.auto" },
  { value: "abort", labelKey: "settings.dataDefaults.missing.policies.abort" },
  { value: "remove_sample", labelKey: "settings.dataDefaults.missing.policies.remove_sample" },
  { value: "remove_feature", labelKey: "settings.dataDefaults.missing.policies.remove_feature" },
  { value: "replace", labelKey: "settings.dataDefaults.missing.policies.replace" },
  { value: "ignore", labelKey: "settings.dataDefaults.missing.policies.ignore" },
];

export const FILL_METHOD_OPTIONS: { value: NaFillConfig["method"]; labelKey: string }[] = [
  { value: "value", labelKey: "settings.dataDefaults.missing.fillMethods.value" },
  { value: "mean", labelKey: "settings.dataDefaults.missing.fillMethods.mean" },
  { value: "median", labelKey: "settings.dataDefaults.missing.fillMethods.median" },
  { value: "forward_fill", labelKey: "settings.dataDefaults.missing.fillMethods.forward_fill" },
  { value: "backward_fill", labelKey: "settings.dataDefaults.missing.fillMethods.backward_fill" },
];

export const ENCODING_OPTIONS = [
  { value: "utf-8", label: "UTF-8 (default)" },
  { value: "latin-1", label: "Latin-1 (ISO-8859-1)" },
  { value: "cp1252", label: "Windows-1252" },
  { value: "iso-8859-1", label: "ISO-8859-1" },
];
