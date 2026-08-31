export const KEYWORD_REGISTRY_SCHEMA_ID = "https://nirs4all.org/schemas/keyword-effects/v1" as const;
export const KEYWORD_REGISTRY_SCHEMA_VERSION = 1 as const;

export type KeywordRegistryStatus = "supported" | "partial" | "planned";
export type KeywordRegistryInvalidation =
  | "always"
  | "if_predictor_changes"
  | "replaces_existing"
  | "extends_existing"
  | "mode_dependent"
  | "not_applicable";

export interface KeywordRegistryAlias {
  kind: "token" | "value";
  name: string;
  canonical: string;
  mode: "read_only";
}

export interface KeywordRegistryUiHint {
  label: string;
  group: string;
  control: string;
  order: number;
}

export interface KeywordRegistryEntry {
  aliases: readonly KeywordRegistryAlias[];
  canonical_term: string;
  changes: readonly string[];
  docs_anchor: string;
  engine_support: Record<string, string>;
  id: string;
  invalidates_calibration: KeywordRegistryInvalidation;
  lifecycle_stage: string;
  path: string;
  reads: readonly string[];
  scope: string;
  status: KeywordRegistryStatus;
  summary: string;
  surface: string;
  token: string;
  ui: KeywordRegistryUiHint;
  value_schema: Record<string, unknown>;
}

export interface KeywordRegistryDocument {
  entries: readonly KeywordRegistryEntry[];
  registry_version: string;
  schema_id: typeof KEYWORD_REGISTRY_SCHEMA_ID;
  schema_version: typeof KEYWORD_REGISTRY_SCHEMA_VERSION;
  scope: string;
}

export interface KeywordRegistryFieldView {
  control: string;
  docsAnchor: string;
  engineSupport: Record<string, string>;
  group: string;
  id: string;
  invalidatesCalibration: KeywordRegistryInvalidation;
  label: string;
  order: number;
  path: string;
  status: KeywordRegistryStatus;
  summary: string;
  valueSchema: Record<string, unknown>;
}

export interface KeywordRegistryFormSection {
  fields: KeywordRegistryFieldView[];
  group: string;
  label: string;
  order: number;
}

export interface KeywordRegistryValueOption {
  label: string;
  value: unknown;
}

export const WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS = [
  "predict.save_to_workspace",
  "predict.workspace_metadata",
  "predict.workspace_result_metadata",
] as const;

export type WorkspacePredictionPublicationKeywordId =
  typeof WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS[number];

export const WORKSPACE_PREDICTION_PUBLICATION_EFFECTS = [
  "workspace_prediction_rows",
  "prediction_arrays",
  "result_metadata",
  "workspace_prediction_id",
  "prediction_sample_metadata",
  "robustness_evidence",
] as const;

export const WORKSPACE_PREDICTION_PUBLICATION_DESTINATION = "result_metadata.robustness_evidence" as const;
export const WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR = "workspace-prediction-bridge" as const;

export interface KeywordRegistryWorkspacePredictionPublicationContract {
  complete: boolean;
  docsAnchor: typeof WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR;
  effects: readonly string[];
  fields: KeywordRegistryFieldView[];
  keywordIds: readonly WorkspacePredictionPublicationKeywordId[];
  missingKeywordIds: WorkspacePredictionPublicationKeywordId[];
  robustnessEvidenceDestination: typeof WORKSPACE_PREDICTION_PUBLICATION_DESTINATION;
}

export interface KeywordRegistryEntryQuery {
  alias?: string;
  id?: string;
  path?: string;
  surface?: string;
  token?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isKeywordRegistryAlias(value: unknown): value is KeywordRegistryAlias {
  return (
    isRecord(value)
    && (value.kind === "token" || value.kind === "value")
    && typeof value.name === "string"
    && typeof value.canonical === "string"
    && value.mode === "read_only"
  );
}

function isKeywordRegistryUiHint(value: unknown): value is KeywordRegistryUiHint {
  return (
    isRecord(value)
    && typeof value.label === "string"
    && typeof value.group === "string"
    && typeof value.control === "string"
    && Number.isInteger(value.order)
  );
}

export function isKeywordRegistryEntry(value: unknown): value is KeywordRegistryEntry {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string"
    && typeof value.token === "string"
    && typeof value.path === "string"
    && typeof value.surface === "string"
    && typeof value.scope === "string"
    && typeof value.canonical_term === "string"
    && (value.status === "supported" || value.status === "partial" || value.status === "planned")
    && isRecord(value.value_schema)
    && Array.isArray(value.aliases)
    && value.aliases.every(isKeywordRegistryAlias)
    && typeof value.lifecycle_stage === "string"
    && isStringArray(value.reads)
    && isStringArray(value.changes)
    && (
      value.invalidates_calibration === "always"
      || value.invalidates_calibration === "if_predictor_changes"
      || value.invalidates_calibration === "replaces_existing"
      || value.invalidates_calibration === "extends_existing"
      || value.invalidates_calibration === "mode_dependent"
      || value.invalidates_calibration === "not_applicable"
    )
    && isRecord(value.engine_support)
    && Object.values(value.engine_support).every((item) => typeof item === "string")
    && typeof value.summary === "string"
    && typeof value.docs_anchor === "string"
    && isKeywordRegistryUiHint(value.ui)
  );
}

export function isKeywordRegistryDocument(value: unknown): value is KeywordRegistryDocument {
  if (!isRecord(value)) return false;
  if (
    value.schema_id !== KEYWORD_REGISTRY_SCHEMA_ID
    || value.schema_version !== KEYWORD_REGISTRY_SCHEMA_VERSION
    || typeof value.registry_version !== "string"
    || typeof value.scope !== "string"
    || !Array.isArray(value.entries)
    || !value.entries.every(isKeywordRegistryEntry)
  ) {
    return false;
  }

  const ids = value.entries.map((entry) => entry.id);
  return ids.length === new Set(ids).size;
}

export function parseKeywordRegistryDocument(value: unknown): KeywordRegistryDocument {
  if (isKeywordRegistryDocument(value)) return value;

  throw new TypeError(`Expected ${KEYWORD_REGISTRY_SCHEMA_ID} schema v${KEYWORD_REGISTRY_SCHEMA_VERSION} keyword registry`);
}

export function keywordRegistryEntriesById(
  registry: KeywordRegistryDocument,
): ReadonlyMap<string, KeywordRegistryEntry> {
  return new Map(registry.entries.map((entry) => [entry.id, entry]));
}

export function keywordRegistryEntriesByPath(
  registry: KeywordRegistryDocument,
): ReadonlyMap<string, KeywordRegistryEntry> {
  return new Map(registry.entries.map((entry) => [entry.path, entry]));
}

export function getKeywordRegistryEntry(
  registry: KeywordRegistryDocument,
  id: string,
): KeywordRegistryEntry | undefined {
  return keywordRegistryEntriesById(registry).get(id);
}

function matchesEntryQuery(entry: KeywordRegistryEntry, query: KeywordRegistryEntryQuery): boolean {
  if (query.id !== undefined && entry.id !== query.id) return false;
  if (query.path !== undefined && entry.path !== query.path) return false;
  if (query.surface !== undefined && entry.surface !== query.surface) return false;
  if (query.token !== undefined && entry.token !== query.token) return false;
  if (
    query.alias !== undefined
    && !entry.aliases.some((alias) => alias.kind === "token" && alias.name === query.alias)
  ) {
    return false;
  }

  return true;
}

export function findKeywordRegistryEntries(
  registry: KeywordRegistryDocument,
  query: KeywordRegistryEntryQuery,
): KeywordRegistryEntry[] {
  return registry.entries
    .filter((entry) => matchesEntryQuery(entry, query))
    .sort((left, right) => left.ui.order - right.ui.order || left.id.localeCompare(right.id));
}

export function findKeywordRegistryEntriesByScope(
  registry: KeywordRegistryDocument,
  scope: string,
): KeywordRegistryEntry[] {
  return registry.entries
    .filter((entry) => entry.scope === scope)
    .sort((left, right) => left.ui.order - right.ui.order || left.id.localeCompare(right.id));
}

export function resolveKeywordRegistryEntry(
  registry: KeywordRegistryDocument,
  query: KeywordRegistryEntryQuery,
): KeywordRegistryEntry | undefined {
  const matches = findKeywordRegistryEntries(registry, query);
  return matches.length === 1 ? matches[0] : undefined;
}

export function createKeywordRegistryFieldViews(
  registry: KeywordRegistryDocument,
  options: { group?: string; status?: KeywordRegistryStatus } = {},
): KeywordRegistryFieldView[] {
  return registry.entries
    .filter((entry) => options.group === undefined || entry.ui.group === options.group)
    .filter((entry) => options.status === undefined || entry.status === options.status)
    .map((entry) => ({
      control: entry.ui.control,
      docsAnchor: entry.docs_anchor,
      engineSupport: entry.engine_support,
      group: entry.ui.group,
      id: entry.id,
      invalidatesCalibration: entry.invalidates_calibration,
      label: entry.ui.label,
      order: entry.ui.order,
      path: entry.path,
      status: entry.status,
      summary: entry.summary,
      valueSchema: entry.value_schema,
    }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function createKeywordRegistryOptimizerPersistenceFields(
  registry: KeywordRegistryDocument,
): KeywordRegistryFieldView[] {
  const scopedRegistry: KeywordRegistryDocument = {
    ...registry,
    entries: findKeywordRegistryEntriesByScope(registry, "optimizer_persistence"),
  };

  return createKeywordRegistryFieldViews(scopedRegistry);
}

export function createKeywordRegistryWorkspacePredictionPublicationContract(
  registry: KeywordRegistryDocument,
): KeywordRegistryWorkspacePredictionPublicationContract {
  const fieldsById = new Map(createKeywordRegistryFieldViews(registry).map((field) => [field.id, field]));
  const fields: KeywordRegistryFieldView[] = [];
  const missingKeywordIds: WorkspacePredictionPublicationKeywordId[] = [];

  for (const id of WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS) {
    const field = fieldsById.get(id);
    if (field === undefined) {
      missingKeywordIds.push(id);
    } else {
      fields.push(field);
    }
  }

  return {
    complete: missingKeywordIds.length === 0,
    docsAnchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
    effects: WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
    fields,
    keywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
    missingKeywordIds,
    robustnessEvidenceDestination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
  };
}

function labelGroup(group: string): string {
  return group
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function labelValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isConstSchema(value: unknown): value is { const: unknown; title?: unknown } {
  return isRecord(value) && "const" in value;
}

export function getKeywordRegistryValueOptions(
  entry: Pick<KeywordRegistryEntry, "value_schema">,
): KeywordRegistryValueOption[] {
  const directEnum = entry.value_schema.enum;
  if (Array.isArray(directEnum)) {
    return directEnum.map((value) => ({ label: labelValue(value), value }));
  }

  const oneOf = entry.value_schema.oneOf;
  if (Array.isArray(oneOf)) {
    return oneOf
      .filter(isConstSchema)
      .map((schema) => ({
        label: typeof schema.title === "string" ? schema.title : labelValue(schema.const),
        value: schema.const,
      }));
  }

  return [];
}

export function createKeywordRegistryFormSections(
  registry: KeywordRegistryDocument,
  options: { status?: KeywordRegistryStatus } = {},
): KeywordRegistryFormSection[] {
  const fields = createKeywordRegistryFieldViews(
    registry,
    options.status === undefined ? {} : { status: options.status },
  );
  const sections = new Map<string, KeywordRegistryFieldView[]>();

  for (const field of fields) {
    const existing = sections.get(field.group);
    if (existing === undefined) {
      sections.set(field.group, [field]);
    } else {
      existing.push(field);
    }
  }

  return [...sections.entries()]
    .map(([group, sectionFields]) => ({
      fields: sectionFields,
      group,
      label: labelGroup(group),
      order: Math.min(...sectionFields.map((field) => field.order)),
    }))
    .sort((left, right) => left.order - right.order || left.group.localeCompare(right.group));
}
