/**
 * nirs4all-ui `datasetBuilder` domain — the reusable multimodal Dataset Builder.
 *
 * A self-contained wizard (Source → Rôle → Colonnes → Validation) that turns
 * heterogeneous, already-parsed source descriptors into a nirs4all dataset
 * config. Same package boundary as the rest of nirs4all-ui: local UI state only,
 * NO file IO, network, browser globals, or runtime execution — hosts parse files
 * into `DatasetSource`s and receive the exported config.
 *
 * The pure engine (detection, validation, schema, export) is exported alongside
 * the components so hosts (or a Python/WASM backend) can reuse the same logic.
 *
 * A default stylesheet ships at `nirs4all-ui/assets/datasetBuilder.css`.
 *
 * Consumed as `nirs4all-ui/datasetBuilder`.
 */

// --- types + pure engine ---
export * from "./types.js";
export * from "./roles.js";
export * from "./locale.js";
export * from "./detect.js";
export * from "./schema.js";
export * from "./validate.js";
export * from "./exportConfig.js";

// --- default icons ---
export { DEFAULT_ICONS, icon, type BuilderIconKey } from "./icons.js";

// --- presentational components ---
export * from "./DatasetBuilder.js";
export * from "./DatasetWizardStepper.js";
export * from "./SourceSummaryCard.js";
export * from "./RoleSelectionCards.js";
export * from "./ColumnMappingTable.js";
export * from "./PartitionPreview.js";
export * from "./DatasetSourceConfigPanel.js";
export * from "./LiveValidationCard.js";
