/**
 * UI chrome strings for the wizard (FR default, EN parallel). Kept separate from
 * role/validation copy so hosts can override the whole label set at once.
 */

import type { Locale } from "./roles.js";
import type { WizardStep } from "./types.js";

export interface BuilderStrings {
  title: string;
  stepSubtitles: Record<WizardStep, string>;
  steps: Record<WizardStep, string>;
  assistantTitle: string;
  assistantSubtitle: string;
  signalType: string;
  fileFormat: string;
  separator: string;
  decimal: string;
  headers: string;
  headersHorizontal: string;
  headersVertical: string;
  columnChoice: string;
  useAs: string;
  autoDetect: string;
  manualColumns: string;
  advanced: string;
  liveValidation: string;
  rolePrompt: string;
  columnHeaderCheckbox: string;
  columnHeaderName: string;
  columnHeaderPreview: string;
  columnHeaderType: string;
  columnHeaderRole: string;
  filterAll: string;
  hideAssigned: string;
  selectSpectra: string;
  columnsDetected: (n: number) => string;
  columnsAssigned: (n: number) => string;
  tip: string;
  tipBody: string;
  partitionTitle: string;
  partitionModes: Record<string, string>;
  addSource: string;
  noSourceHint: string;
  continueLabel: (next: string) => string;
  createDataset: string;
  exportJson: string;
  applyToSelected: (n: number) => string;
  applyToFile: string;
  rows: string;
  columns: string;
  loaded: string;
}

export const STRINGS: Record<Locale, BuilderStrings> = {
  fr: {
    title: "Construction du dataset",
    stepSubtitles: {
      source: "Ajoutez ou sélectionnez une source de données.",
      role: "Définissez comment chaque partie du fichier sera utilisée.",
      columns: "Associez les colonnes aux rôles du dataset.",
      validation: "Vérifiez la cohérence avant création.",
    },
    steps: { source: "Source", role: "Rôle", columns: "Colonnes", validation: "Validation" },
    assistantTitle: "Assistant de configuration",
    assistantSubtitle: "Paramétrez votre fichier étape par étape.",
    signalType: "Type de signal",
    fileFormat: "Format du fichier",
    separator: "Séparateur",
    decimal: "Délimiteur décimal",
    headers: "Headers",
    headersHorizontal: "Horizontaux",
    headersVertical: "Verticaux",
    columnChoice: "Choix des colonnes",
    useAs: "Utiliser comme",
    autoDetect: "Détection automatique",
    manualColumns: "Choix manuel des colonnes",
    advanced: "Options avancées",
    liveValidation: "Validation en temps réel",
    rolePrompt: "Affectez un rôle à chaque partie du fichier",
    columnHeaderCheckbox: "",
    columnHeaderName: "Colonne dans le fichier",
    columnHeaderPreview: "Aperçu",
    columnHeaderType: "Type détecté",
    columnHeaderRole: "Rôle assigné",
    filterAll: "Toutes",
    hideAssigned: "Masquer assignées",
    selectSpectra: "Sélectionner les spectres",
    columnsDetected: (n) => `${n} colonnes détectées`,
    columnsAssigned: (n) => `${n} assignées`,
    tip: "Conseil",
    tipBody:
      "Sélectionnez les colonnes spectrales (X) en bloc. Elles seront utilisées comme variables d'entrée de vos modèles.",
    partitionTitle: "Aperçu de la partition",
    partitionModes: {
      train_test: "Train / Test",
      train_only: "Train uniquement",
      train_val_test: "Train / Val / Test",
      folds: "Folds CV",
    },
    addSource: "Ajouter une source",
    noSourceHint: "Glissez-déposez vos fichiers ou dossiers, ou cliquez pour parcourir.",
    continueLabel: (next) => `Continuer vers ${next}`,
    createDataset: "Créer le dataset",
    exportJson: "Exporter le JSON",
    applyToSelected: (n) => `Appliquer aux ${n} colonnes sélectionnées`,
    applyToFile: "Appliquer au fichier entier",
    rows: "lignes",
    columns: "colonnes",
    loaded: "Fichier chargé",
  },
  en: {
    title: "Dataset construction",
    stepSubtitles: {
      source: "Add or select a data source.",
      role: "Define how each part of the file will be used.",
      columns: "Map columns to dataset roles.",
      validation: "Check consistency before creation.",
    },
    steps: { source: "Source", role: "Role", columns: "Columns", validation: "Validation" },
    assistantTitle: "Configuration assistant",
    assistantSubtitle: "Configure your file step by step.",
    signalType: "Signal type",
    fileFormat: "File format",
    separator: "Separator",
    decimal: "Decimal delimiter",
    headers: "Headers",
    headersHorizontal: "Horizontal",
    headersVertical: "Vertical",
    columnChoice: "Column choice",
    useAs: "Use as",
    autoDetect: "Auto-detection",
    manualColumns: "Manual column choice",
    advanced: "Advanced options",
    liveValidation: "Live validation",
    rolePrompt: "Assign a role to each part of the file",
    columnHeaderCheckbox: "",
    columnHeaderName: "Column in file",
    columnHeaderPreview: "Preview",
    columnHeaderType: "Detected type",
    columnHeaderRole: "Assigned role",
    filterAll: "All",
    hideAssigned: "Hide assigned",
    selectSpectra: "Select spectra",
    columnsDetected: (n) => `${n} columns detected`,
    columnsAssigned: (n) => `${n} assigned`,
    tip: "Tip",
    tipBody:
      "Select the spectral (X) columns in bulk. They will be used as the input variables of your models.",
    partitionTitle: "Partition preview",
    partitionModes: {
      train_test: "Train / Test",
      train_only: "Train only",
      train_val_test: "Train / Val / Test",
      folds: "CV folds",
    },
    addSource: "Add a source",
    noSourceHint: "Drag and drop your files or folders, or click to browse.",
    continueLabel: (next) => `Continue to ${next}`,
    createDataset: "Create dataset",
    exportJson: "Export JSON",
    applyToSelected: (n) => `Apply to ${n} selected columns`,
    applyToFile: "Apply to whole file",
    rows: "rows",
    columns: "columns",
    loaded: "File loaded",
  },
};
