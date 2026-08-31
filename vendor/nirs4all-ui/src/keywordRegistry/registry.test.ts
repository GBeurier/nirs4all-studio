import { describe, expect, it } from "vitest";

import {
  WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
  WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
  WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
  WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
  createKeywordRegistryOptimizerPersistenceFields,
  createKeywordRegistryFieldViews,
  createKeywordRegistryFormSections,
  createKeywordRegistryWorkspacePredictionPublicationContract,
  findKeywordRegistryEntriesByScope,
  findKeywordRegistryEntries,
  getKeywordRegistryEntry,
  getKeywordRegistryValueOptions,
  isKeywordRegistryDocument,
  keywordRegistryEntriesById,
  keywordRegistryEntriesByPath,
  parseKeywordRegistryDocument,
  resolveKeywordRegistryEntry,
} from "./registry.js";

const registry = {
  entries: [
    {
      aliases: [{ canonical: "engine", kind: "token", mode: "read_only", name: "backend" }],
      canonical_term: "execution_backend",
      changes: ["execution_backend"],
      docs_anchor: "execution-engine-versus-optimizer-engine",
      engine_support: { "dag-ml": "partial", legacy: "supported" },
      id: "run.engine",
      invalidates_calibration: "if_predictor_changes",
      lifecycle_stage: "execution",
      path: "run.engine",
      reads: [],
      scope: "pipeline_execution",
      status: "supported",
      summary: "Selects the pipeline execution backend.",
      surface: "run_argument",
      token: "engine",
      ui: { control: "select", group: "execution", label: "Execution backend", order: 10 },
      value_schema: { enum: [null, "legacy", "dag-ml", "dual"], type: ["string", "null"] },
    },
    {
      aliases: [],
      canonical_term: "robustness_scenarios",
      changes: ["robustness_results"],
      docs_anchor: "planned-robustness-campaigns",
      engine_support: { "dag-ml": "partial", legacy: "unsupported" },
      id: "robustness.scenarios",
      invalidates_calibration: "mode_dependent",
      lifecycle_stage: "robustness",
      path: "robustness.scenarios",
      reads: ["external_test_or_production"],
      scope: "robustness_campaign",
      status: "partial",
      summary: "Defines report cells for robustness diagnostics.",
      surface: "robustness_argument",
      token: "scenarios",
      ui: { control: "array", group: "robustness", label: "Robustness scenarios", order: 220 },
      value_schema: {
        items: {
          allOf: [
            {
              else: { not: { required: ["distribution"] } },
              if: { properties: { kind: { enum: ["prediction_noise", "spectral_noise"] } }, required: ["kind"] },
              then: {},
            },
          ],
          properties: {
            distribution: { enum: ["normal", "uniform"], type: "string" },
            kind: { enum: ["observed", "prediction_bias", "prediction_noise", "spectral_noise", "spectral_shift"], type: "string" },
            severity: { type: "number" },
          },
          required: ["kind"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
    },
  ],
  registry_version: "1.0.0",
  schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
  schema_version: 1,
  scope: "lifecycle-v1",
} as const;

describe("keyword registry helpers", () => {
  it("validates and parses the registry document shape", () => {
    expect(isKeywordRegistryDocument(registry)).toBe(true);
    expect(parseKeywordRegistryDocument(registry)).toBe(registry);
    expect(() => parseKeywordRegistryDocument({ ...registry, entries: [registry.entries[0], registry.entries[0]] })).toThrow(
      /keyword registry/,
    );
  });

  it("indexes entries by stable id", () => {
    const entries = keywordRegistryEntriesById(registry);

    expect(entries.get("run.engine")?.path).toBe("run.engine");
    expect(keywordRegistryEntriesByPath(registry).get("run.engine")?.id).toBe("run.engine");
    expect(getKeywordRegistryEntry(registry, "robustness.scenarios")?.ui.label).toBe("Robustness scenarios");
    expect(getKeywordRegistryEntry(registry, "missing")).toBeUndefined();
  });

  it("resolves form fields by id, path, token, and read-only token alias", () => {
    expect(resolveKeywordRegistryEntry(registry, { id: "run.engine" })?.path).toBe("run.engine");
    expect(resolveKeywordRegistryEntry(registry, { path: "robustness.scenarios" })?.id).toBe("robustness.scenarios");
    expect(resolveKeywordRegistryEntry(registry, { token: "engine" })?.id).toBe("run.engine");
    expect(resolveKeywordRegistryEntry(registry, { alias: "backend" })?.id).toBe("run.engine");
    expect(resolveKeywordRegistryEntry(registry, { token: "scenarios", surface: "robustness_argument" })?.id).toBe(
      "robustness.scenarios",
    );
    expect(resolveKeywordRegistryEntry(registry, { token: "missing" })).toBeUndefined();
  });

  it("lists ambiguous token matches without selecting a winner", () => {
    const ambiguous = parseKeywordRegistryDocument({
      ...registry,
      entries: [
        registry.entries[0],
        {
          ...registry.entries[1],
          id: "predict.engine",
          path: "predict.engine",
          token: "engine",
          ui: { ...registry.entries[1].ui, order: 30 },
        },
      ],
    });

    expect(resolveKeywordRegistryEntry(ambiguous, { token: "engine" })).toBeUndefined();
    expect(findKeywordRegistryEntries(ambiguous, { token: "engine" }).map((entry) => entry.id)).toEqual([
      "run.engine",
      "predict.engine",
    ]);
  });

  it("projects optimizer persistence fields for HPO forms without inferring execution", () => {
    const withPersistence = parseKeywordRegistryDocument({
      ...registry,
      entries: [
        ...registry.entries,
        {
          aliases: [],
          canonical_term: "optimizer_storage_uri",
          changes: ["optimizer_state"],
          docs_anchor: "planned-full-dag-tuning",
          engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
          id: "run.tuning.storage",
          invalidates_calibration: "not_applicable",
          lifecycle_stage: "storage",
          path: "run.tuning.storage",
          reads: ["optimizer_state"],
          scope: "optimizer_persistence",
          status: "partial",
          summary: "Optuna storage URI.",
          surface: "nested_key",
          token: "storage",
          ui: { control: "text", group: "tuning", label: "Optuna storage URI", order: 254 },
          value_schema: { minLength: 1, pattern: "^[A-Za-z][A-Za-z0-9+.-]*://", type: "string" },
        },
        {
          aliases: [],
          canonical_term: "optimizer_study_name",
          changes: ["optimizer_state"],
          docs_anchor: "planned-full-dag-tuning",
          engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
          id: "run.tuning.study_name",
          invalidates_calibration: "not_applicable",
          lifecycle_stage: "storage",
          path: "run.tuning.study_name",
          reads: ["optimizer_state"],
          scope: "optimizer_persistence",
          status: "partial",
          summary: "Optuna study name.",
          surface: "nested_key",
          token: "study_name",
          ui: { control: "text", group: "tuning", label: "Optuna study name", order: 255 },
          value_schema: { minLength: 1, pattern: "^[^\\u0000]+$", type: "string" },
        },
      ],
    });

    expect(findKeywordRegistryEntriesByScope(withPersistence, "optimizer_persistence").map((entry) => entry.id)).toEqual([
      "run.tuning.storage",
      "run.tuning.study_name",
    ]);
    expect(createKeywordRegistryOptimizerPersistenceFields(withPersistence)).toEqual([
      expect.objectContaining({
        engineSupport: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
        id: "run.tuning.storage",
        invalidatesCalibration: "not_applicable",
        label: "Optuna storage URI",
        valueSchema: { minLength: 1, pattern: "^[A-Za-z][A-Za-z0-9+.-]*://", type: "string" },
      }),
      expect.objectContaining({
        engineSupport: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
        id: "run.tuning.study_name",
        invalidatesCalibration: "not_applicable",
        label: "Optuna study name",
        valueSchema: { minLength: 1, pattern: "^[^\\u0000]+$", type: "string" },
      }),
    ]);
  });

  it("projects the workspace prediction publication contract from public predict keywords", () => {
    const withPredictionPublication = parseKeywordRegistryDocument({
      ...registry,
      entries: [
        ...registry.entries,
        {
          aliases: [],
          canonical_term: "workspace_prediction_publisher",
          changes: ["workspace_prediction_rows", "prediction_arrays", "result_metadata", "workspace_prediction_id"],
          docs_anchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
          engine_support: { "dag-ml": "partial", legacy: "supported" },
          id: "predict.save_to_workspace",
          invalidates_calibration: "not_applicable",
          lifecycle_stage: "prediction_storage",
          path: "predict.save_to_workspace",
          reads: ["prediction_result", "prediction_input_X"],
          scope: "prediction_publishing",
          status: "partial",
          summary: "Publishes the returned PredictResult to the workspace prediction store.",
          surface: "predict_argument",
          token: "save_to_workspace",
          ui: { control: "select", group: "prediction_publishing", label: "Save prediction to workspace", order: 410 },
          value_schema: { type: "boolean" },
        },
        {
          aliases: [],
          canonical_term: "workspace_prediction_sample_metadata",
          changes: ["prediction_sample_metadata"],
          docs_anchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
          engine_support: { "dag-ml": "partial", legacy: "supported" },
          id: "predict.workspace_metadata",
          invalidates_calibration: "not_applicable",
          lifecycle_stage: "prediction_storage",
          path: "predict.workspace_metadata",
          reads: ["prediction_input_metadata"],
          scope: "prediction_publishing",
          status: "partial",
          summary: "Attaches sample metadata to published workspace predictions.",
          surface: "predict_argument",
          token: "workspace_metadata",
          ui: { control: "object", group: "prediction_publishing", label: "Prediction sample metadata", order: 411 },
          value_schema: { type: "object" },
        },
        {
          aliases: [],
          canonical_term: "workspace_prediction_result_metadata",
          changes: ["result_metadata", "robustness_evidence"],
          docs_anchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
          engine_support: { "dag-ml": "partial", legacy: "supported" },
          id: "predict.workspace_result_metadata",
          invalidates_calibration: "not_applicable",
          lifecycle_stage: "prediction_storage",
          path: "predict.workspace_result_metadata",
          reads: ["prediction_result_metadata"],
          scope: "prediction_publishing",
          status: "partial",
          summary: "Publishes result metadata such as robustness_evidence.",
          surface: "predict_argument",
          token: "workspace_result_metadata",
          ui: { control: "object", group: "prediction_publishing", label: "Prediction result metadata", order: 412 },
          value_schema: { type: "object" },
        },
      ],
    });

    expect(createKeywordRegistryWorkspacePredictionPublicationContract(withPredictionPublication)).toEqual({
      complete: true,
      docsAnchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
      effects: WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
      fields: [
        expect.objectContaining({ id: "predict.save_to_workspace", invalidatesCalibration: "not_applicable" }),
        expect.objectContaining({ id: "predict.workspace_metadata", invalidatesCalibration: "not_applicable" }),
        expect.objectContaining({ id: "predict.workspace_result_metadata", invalidatesCalibration: "not_applicable" }),
      ],
      keywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
      missingKeywordIds: [],
      robustnessEvidenceDestination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
    });
  });

  it("fails closed when workspace prediction publication keywords are absent", () => {
    expect(createKeywordRegistryWorkspacePredictionPublicationContract(registry)).toEqual({
      complete: false,
      docsAnchor: WORKSPACE_PREDICTION_PUBLICATION_DOCS_ANCHOR,
      effects: WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
      fields: [],
      keywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
      missingKeywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
      robustnessEvidenceDestination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
    });
  });

  it("projects field views sorted by UI order without inferring execution support", () => {
    expect(createKeywordRegistryFieldViews(registry)).toEqual([
      expect.objectContaining({
        engineSupport: { "dag-ml": "partial", legacy: "supported" },
        id: "run.engine",
        invalidatesCalibration: "if_predictor_changes",
        label: "Execution backend",
        order: 10,
        status: "supported",
      }),
      expect.objectContaining({
        engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
        id: "robustness.scenarios",
        invalidatesCalibration: "mode_dependent",
        label: "Robustness scenarios",
        order: 220,
        status: "partial",
      }),
    ]);
    expect(createKeywordRegistryFieldViews(registry, { group: "robustness" }).map((field) => field.id)).toEqual([
      "robustness.scenarios",
    ]);
  });

  it("groups field views into ordered form sections", () => {
    expect(createKeywordRegistryFormSections(registry)).toEqual([
      {
        fields: [
          expect.objectContaining({
            id: "run.engine",
            label: "Execution backend",
            order: 10,
          }),
        ],
        group: "execution",
        label: "Execution",
        order: 10,
      },
      {
        fields: [
          expect.objectContaining({
            id: "robustness.scenarios",
            label: "Robustness scenarios",
            order: 220,
          }),
        ],
        group: "robustness",
        label: "Robustness",
        order: 220,
      },
    ]);
    expect(createKeywordRegistryFormSections(registry, { status: "partial" }).map((section) => section.group)).toEqual([
      "robustness",
    ]);
  });

  it("preserves nested value_schema constraints for host-side form validation", () => {
    const robustnessScenarios = getKeywordRegistryEntry(registry, "robustness.scenarios");

    expect(robustnessScenarios?.value_schema).toEqual(
      expect.objectContaining({
        items: expect.objectContaining({
          allOf: [
            {
              else: { not: { required: ["distribution"] } },
              if: { properties: { kind: { enum: ["prediction_noise", "spectral_noise"] } }, required: ["kind"] },
              then: {},
            },
          ],
        }),
      }),
    );
  });

  it("extracts declared enum and oneOf const options for form controls", () => {
    expect(getKeywordRegistryValueOptions(registry.entries[0])).toEqual([
      { label: "null", value: null },
      { label: "legacy", value: "legacy" },
      { label: "dag-ml", value: "dag-ml" },
      { label: "dual", value: "dual" },
    ]);
    expect(
      getKeywordRegistryValueOptions({
        value_schema: {
          oneOf: [
            { const: 0.9, title: "90%" },
            { const: 0.95 },
            { type: "number" },
          ],
        },
      }),
    ).toEqual([
      { label: "90%", value: 0.9 },
      { label: "0.95", value: 0.95 },
    ]);
    expect(getKeywordRegistryValueOptions(registry.entries[1])).toEqual([]);
  });
});
