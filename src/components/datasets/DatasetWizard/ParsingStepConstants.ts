/**
 * Select option lists for the parsing-step forms.
 *
 * Pure presentation data shared by the parsing form, per-file overrides,
 * and the advanced loading options section.
 */
import type { HeaderUnit, SignalType, NaPolicy, NaFillConfig } from "@/types/datasets";

export const DELIMITER_OPTIONS = [
  { value: ";", labelKey: "datasets.wizard.parsing.delimiters.semicolon" },
  { value: ",", labelKey: "datasets.wizard.parsing.delimiters.comma" },
  { value: "\t", labelKey: "datasets.wizard.parsing.delimiters.tab" },
  { value: "|", labelKey: "datasets.wizard.parsing.delimiters.pipe" },
  { value: " ", labelKey: "datasets.wizard.parsing.delimiters.space" },
];

export const DECIMAL_OPTIONS = [
  { value: ".", labelKey: "datasets.wizard.parsing.decimals.dot" },
  { value: ",", labelKey: "datasets.wizard.parsing.decimals.comma" },
];

export const HEADER_UNIT_OPTIONS: { value: HeaderUnit; labelKey: string }[] = [
  { value: "nm", labelKey: "datasets.wizard.parsing.headerUnits.nm" },
  { value: "cm-1", labelKey: "datasets.wizard.parsing.headerUnits.cm-1" },
  { value: "text", labelKey: "datasets.wizard.parsing.headerUnits.text" },
  { value: "index", labelKey: "datasets.wizard.parsing.headerUnits.index" },
  { value: "none", labelKey: "datasets.wizard.parsing.headerUnits.none" },
];

export const SIGNAL_TYPE_OPTIONS: { value: SignalType; labelKey: string }[] = [
  { value: "auto", labelKey: "datasets.wizard.parsing.signalTypes.auto" },
  { value: "absorbance", labelKey: "datasets.wizard.parsing.signalTypes.absorbance" },
  { value: "reflectance", labelKey: "datasets.wizard.parsing.signalTypes.reflectance" },
  { value: "reflectance%", labelKey: "datasets.wizard.parsing.signalTypes.reflectancePct" },
  { value: "transmittance", labelKey: "datasets.wizard.parsing.signalTypes.transmittance" },
  { value: "transmittance%", labelKey: "datasets.wizard.parsing.signalTypes.transmittancePct" },
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
  { value: "utf-8", labelKey: "datasets.wizard.parsing.encodings.utf8" },
  { value: "latin-1", labelKey: "datasets.wizard.parsing.encodings.latin1" },
  { value: "cp1252", labelKey: "datasets.wizard.parsing.encodings.cp1252" },
  { value: "iso-8859-1", labelKey: "datasets.wizard.parsing.encodings.iso88591" },
];
