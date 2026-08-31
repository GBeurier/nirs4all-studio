/**
 * Stable, colour-coded metadata for every dataset role and signal type.
 *
 * Colours are exposed as design tokens (a stable `token` key + a CSS custom
 * property name) so hosts can theme them, while the shipped stylesheet gives a
 * working default that matches the product mock (X=blue, Y=red, metadata=green,
 * ID=amber, partition=grey, replicate=violet, group=cyan).
 */

import type { DatasetRole, SignalType } from "./types.js";

export type Locale = "fr" | "en";

export interface RoleDescriptor {
  role: DatasetRole;
  /** stable colour token, used as `data-role` and to pick CSS variables. */
  token: string;
  labels: Record<Locale, string>;
  hints: Record<Locale, string>;
  /** short one-liner shown under the role name on the big role cards. */
  descriptions: Record<Locale, string>;
}

export const ROLE_ORDER: DatasetRole[] = [
  "x",
  "y",
  "metadata",
  "id",
  "partition",
  "replicate",
  "group",
];

export const ROLE_DESCRIPTORS: Record<DatasetRole, RoleDescriptor> = {
  x: {
    role: "x",
    token: "x",
    labels: { fr: "X", en: "X" },
    hints: { fr: "Variables spectrales / images / séries", en: "Spectra / images / time series" },
    descriptions: {
      fr: "Variables d'entrée des modèles",
      en: "Model input variables",
    },
  },
  y: {
    role: "y",
    token: "y",
    labels: { fr: "Y — Cibles", en: "Y — Targets" },
    hints: { fr: "Variables à prédire", en: "Variables to predict" },
    descriptions: { fr: "Cibles à prédire", en: "Targets to predict" },
  },
  metadata: {
    role: "metadata",
    token: "metadata",
    labels: { fr: "Metadata", en: "Metadata" },
    hints: { fr: "Infos contextuelles, facteurs", en: "Context, factors, covariates" },
    descriptions: { fr: "Variables descriptives", en: "Descriptive variables" },
  },
  id: {
    role: "id",
    token: "id",
    labels: { fr: "IDs", en: "IDs" },
    hints: { fr: "Jointures et alignements", en: "Joins and alignment" },
    descriptions: { fr: "Colonnes d'identifiants", en: "Identifier columns" },
  },
  partition: {
    role: "partition",
    token: "partition",
    labels: { fr: "Partition", en: "Partition" },
    hints: { fr: "Train / test / validation / folds", en: "Train / test / validation / folds" },
    descriptions: { fr: "Séparation des données", en: "Data splitting" },
  },
  replicate: {
    role: "replicate",
    token: "replicate",
    labels: { fr: "Répétition", en: "Replicate" },
    hints: { fr: "Scans, réplicats techniques", en: "Scans, technical replicates" },
    descriptions: { fr: "Mesures répétées", en: "Repeated measurements" },
  },
  group: {
    role: "group",
    token: "group",
    labels: { fr: "Groupe", en: "Group" },
    hints: { fr: "GroupKFold, site, génotype, bloc", en: "GroupKFold, site, genotype, block" },
    descriptions: { fr: "Groupes de validation", en: "Validation groups" },
  },
  ignored: {
    role: "ignored",
    token: "ignored",
    labels: { fr: "Ignorée", en: "Ignored" },
    hints: { fr: "Non utilisée dans le dataset", en: "Not used in the dataset" },
    descriptions: { fr: "Colonne non assignée", en: "Unassigned column" },
  },
};

export function roleLabel(role: DatasetRole, locale: Locale = "fr"): string {
  return ROLE_DESCRIPTORS[role].labels[locale];
}

export function roleToken(role: DatasetRole): string {
  return ROLE_DESCRIPTORS[role].token;
}

export interface SignalTypeOption {
  value: SignalType;
  labels: Record<Locale, string>;
}

export const SIGNAL_TYPES: SignalTypeOption[] = [
  { value: "spectra", labels: { fr: "Spectres", en: "Spectra" } },
  { value: "table", labels: { fr: "Table tabulaire", en: "Tabular table" } },
  { value: "image", labels: { fr: "Images", en: "Images" } },
  { value: "timeseries", labels: { fr: "Série temporelle", en: "Time series" } },
  { value: "hyperspectral", labels: { fr: "Hyperspectral", en: "Hyperspectral" } },
  { value: "metadata", labels: { fr: "Metadata", en: "Metadata" } },
  { value: "target", labels: { fr: "Labels / cibles", en: "Labels / targets" } },
  { value: "other", labels: { fr: "Autre", en: "Other" } },
];

export function signalTypeLabel(signal: SignalType, locale: Locale = "fr"): string {
  return SIGNAL_TYPES.find((s) => s.value === signal)?.labels[locale] ?? signal;
}
