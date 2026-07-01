import { describe, expect, it } from "vitest";

import {
  buildResultArtifactPresentationReadModel,
  buildResultArtifactRepositoryProvenanceItems,
  buildResultArtifactSourceScopeGroupItems,
  buildResultArtifactSourceScopeReadModel,
  buildAvailableModelArtifactRef,
  buildFoldModelArtifactRefs,
  buildPipelineRunArtifactRefs,
  buildPredictionArraysArtifactRef,
  buildPredictionRecordModelArtifactRefs,
  filterResultArtifactRefs,
  filterResultArtifactRefsBySourceScope,
  formatResultArtifactContentAddressLabel,
  formatResultArtifactCountLabel,
  getResultArtifactKindLabel,
  getResultArtifactScopeLabel,
  getResultArtifactSourceLabel,
  getResultArtifactStatusLabel,
  type ResultArtifactRef,
} from "../resultArtifacts";
import type { PredictionArraysResponse } from "@/types/aggregated-predictions";
import type { PredictionRecord } from "@/types/linked-workspaces";
import type { AvailableModel } from "@/types/predict";
import type { PipelineRun } from "@/types/runs";

function pipeline(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-pipeline",
    pipeline_id: "pipe-1",
    pipeline_name: "PLS baseline",
    model: "PLS",
    preprocessing: "SNV",
    split_strategy: "KFold",
    status: "completed",
    progress: 100,
    metrics: { r2: 0.91, rmse: 0.12 },
    val_score: 0.13,
    test_score: 0.12,
    ...overrides,
  };
}

function prediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: "pred-1",
    source_dataset: "dataset-a",
    source_file: "predictions.meta.parquet",
    dataset_name: "fallback-dataset",
    model_name: "PLS",
    partition: "test",
    ...overrides,
  };
}

function availableModel(overrides: Partial<AvailableModel> = {}): AvailableModel {
  return {
    id: "chain-1",
    name: "PLS",
    source: "chain",
    model_class: "PLSRegression",
    dataset_name: "dataset-a",
    metric: "rmse",
    best_score: 0.12,
    created_at: null,
    file_size: null,
    preprocessing: "SNV",
    bundle_path: null,
    ...overrides,
  };
}

function artifactRef(overrides: Partial<ResultArtifactRef> = {}): ResultArtifactRef {
  return {
    id: overrides.id ?? "artifact-ref",
    kind: "model",
    role: "model",
    label: "Model",
    source: "pipeline-run",
    scope: "pipeline",
    status: "available",
    ...overrides,
  };
}

describe("resultArtifacts", () => {
  it("filters result artifact refs by source and scope while preserving order", () => {
    const refs = [
      artifactRef({ id: "pipeline-model", source: "pipeline-run", scope: "pipeline" }),
      artifactRef({ id: "repo-campaign-model", source: "result-repository", scope: "campaign" }),
      artifactRef({ id: "repo-model", source: "result-repository", scope: "model" }),
      artifactRef({ id: "arrays", kind: "prediction_arrays", source: "prediction-arrays", scope: "prediction" }),
    ];

    expect(filterResultArtifactRefsBySourceScope(refs, {
      sources: ["result-repository"],
      scopes: ["campaign"],
    }).map(ref => ref.id)).toEqual(["repo-campaign-model"]);

    expect(filterResultArtifactRefsBySourceScope(refs, {
      sources: ["result-repository"],
    }).map(ref => ref.id)).toEqual(["repo-campaign-model", "repo-model"]);
  });

  it("filters result artifact refs by kind, status, source, and scope while preserving order", () => {
    const refs = [
      artifactRef({ id: "repo-entry", kind: "repository_entry", source: "result-repository", scope: "campaign", status: "available" }),
      artifactRef({ id: "benchmark", kind: "benchmark_metrics", source: "benchmark-export", scope: "campaign", status: "available" }),
      artifactRef({ id: "planned-shap", kind: "shap_explanation", source: "generated", scope: "model", status: "planned" }),
      artifactRef({ id: "missing-optuna", kind: "optuna_study", source: "cluster-run", scope: "run", status: "missing" }),
      artifactRef({ id: "virtual-metrics", kind: "metric_table", source: "pipeline-run", scope: "pipeline", status: "virtual" }),
    ];

    expect(filterResultArtifactRefs(refs, {
      kinds: ["benchmark_metrics", "shap_explanation", "optuna_study"],
      statuses: ["available", "planned"],
      scopes: ["campaign", "model"],
    }).map(ref => ref.id)).toEqual(["benchmark", "planned-shap"]);
  });

  it("builds a source/scope read model for repository and campaign artifact refs", () => {
    const refs = [
      artifactRef({ id: "repo-campaign-model", source: "result-repository", scope: "campaign" }),
      artifactRef({ id: "pipeline-config", kind: "pipeline_config", source: "pipeline-run", scope: "pipeline" }),
      artifactRef({ id: "repo-campaign-metrics", kind: "metric_table", source: "result-repository", scope: "campaign" }),
      artifactRef({ id: "generated-campaign", source: "generated", scope: "campaign" }),
    ];

    const model = buildResultArtifactSourceScopeReadModel(refs, {
      scopes: ["campaign"],
    });

    expect(model.refs.map(ref => ref.id)).toEqual([
      "repo-campaign-model",
      "repo-campaign-metrics",
      "generated-campaign",
    ]);
    expect(model.groups.map(group => ({
      id: group.id,
      source: group.source,
      scope: group.scope,
      refs: group.refs.map(ref => ref.id),
    }))).toEqual([
      {
        id: "source-scope:result-repository:campaign",
        source: "result-repository",
        scope: "campaign",
        refs: ["repo-campaign-model", "repo-campaign-metrics"],
      },
      {
        id: "source-scope:generated:campaign",
        source: "generated",
        scope: "campaign",
        refs: ["generated-campaign"],
      },
    ]);
    expect(model.bySource["result-repository"]?.map(ref => ref.id)).toEqual([
      "repo-campaign-model",
      "repo-campaign-metrics",
    ]);
    expect(model.byScope.campaign?.map(ref => ref.id)).toEqual([
      "repo-campaign-model",
      "repo-campaign-metrics",
      "generated-campaign",
    ]);
  });

  it("builds source/scope display items for repository and campaign artifact groups", () => {
    const model = buildResultArtifactSourceScopeReadModel([
      artifactRef({ id: "repo-campaign-model", source: "result-repository", scope: "campaign" }),
      artifactRef({ id: "repo-campaign-metrics", kind: "metric_table", source: "result-repository", scope: "campaign" }),
      artifactRef({ id: "cluster-run-log", kind: "execution_log", source: "cluster-run", scope: "run" }),
    ]);

    expect(getResultArtifactSourceLabel("result-repository")).toBe("Result repository");
    expect(getResultArtifactScopeLabel("campaign")).toBe("Campaign");
    expect(formatResultArtifactCountLabel(1)).toBe("1 artifact");
    expect(formatResultArtifactCountLabel(2)).toBe("2 artifacts");

    expect(buildResultArtifactSourceScopeGroupItems(model.groups).map(group => ({
      id: group.id,
      label: group.label,
      sourceLabel: group.sourceLabel,
      scopeLabel: group.scopeLabel,
      artifactCount: group.artifactCount,
      artifactCountLabel: group.artifactCountLabel,
      refs: group.refs.map(ref => ref.id),
    }))).toEqual([
      {
        id: "source-scope:result-repository:campaign",
        label: "Result repository / Campaign",
        sourceLabel: "Result repository",
        scopeLabel: "Campaign",
        artifactCount: 2,
        artifactCountLabel: "2 artifacts",
        refs: ["repo-campaign-model", "repo-campaign-metrics"],
      },
      {
        id: "source-scope:cluster-run:run",
        label: "Cluster run / Run",
        sourceLabel: "Cluster run",
        scopeLabel: "Run",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
        refs: ["cluster-run-log"],
      },
    ]);
  });

  it("builds a presentation read model with stable labels and counts by artifact dimension", () => {
    const refs = [
      artifactRef({ id: "repo-entry", kind: "repository_entry", source: "result-repository", scope: "campaign", status: "available" }),
      artifactRef({ id: "benchmark", kind: "benchmark_metrics", source: "benchmark-export", scope: "campaign", status: "available" }),
      artifactRef({ id: "planned-shap", kind: "shap_explanation", source: "generated", scope: "model", status: "planned" }),
      artifactRef({ id: "missing-optuna", kind: "optuna_study", source: "cluster-run", scope: "run", status: "missing" }),
      artifactRef({ id: "virtual-metrics", kind: "metric_table", source: "pipeline-run", scope: "pipeline", status: "virtual" }),
    ];

    const model = buildResultArtifactPresentationReadModel(refs, {
      sources: ["result-repository", "benchmark-export", "generated", "cluster-run"],
      statuses: ["available", "planned", "missing"],
    });

    expect(getResultArtifactKindLabel("benchmark_metrics")).toBe("Benchmark metrics");
    expect(getResultArtifactKindLabel("shap_explanation")).toBe("SHAP explanation");
    expect(getResultArtifactKindLabel("optuna_study")).toBe("Optuna study");
    expect(getResultArtifactKindLabel("repository_entry")).toBe("Repository entry");
    expect(getResultArtifactStatusLabel("planned")).toBe("Planned");
    expect(getResultArtifactStatusLabel("missing")).toBe("Missing");

    expect(model.refs.map(ref => ref.id)).toEqual([
      "repo-entry",
      "benchmark",
      "planned-shap",
      "missing-optuna",
    ]);
    expect(model.totalArtifactCount).toBe(4);
    expect(model.totalArtifactCountLabel).toBe("4 artifacts");
    expect(model.byKind.shap_explanation?.map(ref => ref.id)).toEqual(["planned-shap"]);
    expect(model.byStatus.available?.map(ref => ref.id)).toEqual(["repo-entry", "benchmark"]);
    expect(model.bySource["cluster-run"]?.map(ref => ref.id)).toEqual(["missing-optuna"]);
    expect(model.byScope.campaign?.map(ref => ref.id)).toEqual(["repo-entry", "benchmark"]);

    expect(model.kindItems.map(item => ({
      id: item.id,
      label: item.label,
      artifactCount: item.artifactCount,
      artifactCountLabel: item.artifactCountLabel,
    }))).toEqual([
      {
        id: "kind:benchmark_metrics",
        label: "Benchmark metrics",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
      },
      {
        id: "kind:shap_explanation",
        label: "SHAP explanation",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
      },
      {
        id: "kind:optuna_study",
        label: "Optuna study",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
      },
      {
        id: "kind:repository_entry",
        label: "Repository entry",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
      },
    ]);
    expect(model.statusItems.map(item => [item.value, item.artifactCount])).toEqual([
      ["available", 2],
      ["planned", 1],
      ["missing", 1],
    ]);
    expect(model.sourceItems.map(item => [item.value, item.label, item.artifactCountLabel])).toEqual([
      ["benchmark-export", "Benchmark export", "1 artifact"],
      ["result-repository", "Result repository", "1 artifact"],
      ["cluster-run", "Cluster run", "1 artifact"],
      ["generated", "Generated", "1 artifact"],
    ]);
    expect(model.scopeItems.map(item => [item.value, item.artifactCount])).toEqual([
      ["run", 1],
      ["model", 1],
      ["campaign", 2],
    ]);
  });

  it("builds repository provenance items for content-addressed artifact refs", () => {
    const refs = [
      artifactRef({
        id: "repo-entry",
        kind: "repository_entry",
        label: "Repository manifest",
        source: "result-repository",
        scope: "campaign",
        contentAddress: "sha256:1234567890abcdef1234567890abcdef",
        metadata: {
          repository_id: "repo-1",
          source_ref: "manifests/result.json",
        },
      }),
      artifactRef({
        id: "pipeline-config",
        kind: "pipeline_config",
        label: "Pipeline configuration",
        source: "pipeline-run",
        scope: "pipeline",
      }),
    ];

    expect(formatResultArtifactContentAddressLabel("sha256:1234567890abcdef1234567890abcdef")).toBe("sha256:1234567890ab...abcdef");
    expect(buildResultArtifactRepositoryProvenanceItems(refs)).toEqual([{
      id: "repository-provenance:repo-entry",
      refId: "repo-entry",
      label: "Repository manifest",
      sourceLabel: "Result repository",
      contentAddress: "sha256:1234567890abcdef1234567890abcdef",
      contentAddressLabel: "sha256:1234567890ab...abcdef",
      detailLabels: [
        "Content sha256:1234567890ab...abcdef",
        "Repository repo-1",
        "Source manifests/result.json",
      ],
    }]);
  });

  it("normalizes legacy fold_artifacts into stable fold model refs", () => {
    const refs = buildFoldModelArtifactRefs({
      fold_2: "artifact-fold-2",
      fold_final: "artifact-final",
      fold_0: "artifact-fold-0",
    }, {
      runId: "run-1",
      pipelineId: "pipe-1",
      chainId: "chain-1",
      datasetName: "dataset-a",
      metric: "rmse",
    });

    expect(refs.map(ref => ref.foldId)).toEqual(["final", "0", "2"]);
    expect(refs[0]).toMatchObject({
      kind: "model",
      role: "refit-model",
      label: "Final (refit) model",
      source: "legacy-fold-artifacts",
      scope: "fold",
      status: "available",
      artifactId: "artifact-final",
      runId: "run-1",
      pipelineId: "pipe-1",
      chainId: "chain-1",
      datasetName: "dataset-a",
      metric: "rmse",
      metadata: { foldArtifactKey: "fold_final" },
    });
  });

  it("builds additive pipeline-run refs for model, config, metrics, and logs", () => {
    const refs = buildPipelineRunArtifactRefs(pipeline({
      refit_model_id: "artifact-refit",
      config: { steps: [] },
      logs: ["started", "finished"],
      score_metric: "rmse",
    }));

    expect(refs.map(ref => ref.kind)).toEqual([
      "model",
      "pipeline_config",
      "metric_table",
      "execution_log",
    ]);
    expect(refs.find(ref => ref.kind === "model")).toMatchObject({
      artifactId: "artifact-refit",
      role: "refit-model",
      scope: "pipeline",
    });
    expect(refs.find(ref => ref.kind === "metric_table")?.metadata).toEqual({
      metricKeys: ["r2", "rmse"],
      hasCvScore: true,
      hasTestScore: true,
    });
    expect(refs.find(ref => ref.kind === "execution_log")?.metadata).toEqual({ lineCount: 2 });
  });

  it("includes attached repository artifact refs from pipeline run payloads", () => {
    const refs = buildPipelineRunArtifactRefs({
      ...pipeline({
        metrics: undefined,
        val_score: null,
        test_score: null,
        score: null,
      }),
      artifact_refs: [{
        id: "repo-entry",
        kind: "repository_entry",
        role: "manifest-entry",
        label: "Repository manifest",
        source: "result-repository",
        scope: "campaign",
        status: "available",
        content_address: "sha256:1234567890abcdef1234567890abcdef",
        metadata: {
          repository_id: "repo-1",
          source_ref: "manifests/result.json",
        },
      }],
    } as PipelineRun & { artifact_refs: unknown[] });

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: "repo-entry",
      kind: "repository_entry",
      role: "manifest-entry",
      label: "Repository manifest",
      source: "result-repository",
      scope: "campaign",
      status: "available",
      contentAddress: "sha256:1234567890abcdef1234567890abcdef",
      runId: "run-pipeline",
      pipelineId: "pipe-1",
      metadata: {
        repository_id: "repo-1",
        source_ref: "manifests/result.json",
      },
    });
  });

  it("normalizes native_result_refs into native result artifact refs", () => {
    const refs = buildPipelineRunArtifactRefs({
      ...pipeline({
        metrics: undefined,
        val_score: null,
        test_score: null,
        score: null,
      }),
      native_result_refs: [
        {
          source: "native_results",
          role: "run_dir",
          artifact_type: "native_results_dir",
          run_id: "native-run",
          path: "/tmp/nirs4all_results/native-run",
          manifest_path: "/tmp/nirs4all_results/native-run/manifest.json",
        },
        {
          source: "rt_result",
          role: "model_artifact",
          artifact_type: "native_artifact_ref",
          artifact_id: "artifact:model:compat.1:nirs4all:refit:variant:base",
          uri: "artifacts/model.joblib",
          backend: "joblib",
          kind: "model",
          content_fingerprint: "sha256:model",
        },
      ],
    });

    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      id: "native-result:run-pipeline:run_dir:%2Ftmp%2Fnirs4all_results%2Fnative-run",
      kind: "native_result",
      role: "run_dir",
      label: "Native results directory",
      source: "native-results",
      scope: "run",
      status: "available",
      runId: "run-pipeline",
      pipelineId: "pipe-1",
      format: "directory",
      metadata: {
        source: "native_results",
        artifactType: "native_results_dir",
        nativeRunId: "native-run",
        path: "/tmp/nirs4all_results/native-run",
        manifestPath: "/tmp/nirs4all_results/native-run/manifest.json",
      },
    });
    expect(refs[1]).toMatchObject({
      kind: "model",
      role: "model_artifact",
      label: "Native model artifact",
      source: "native-results",
      scope: "model",
      status: "available",
      artifactId: "artifact:model:compat.1:nirs4all:refit:variant:base",
      runId: "run-pipeline",
      pipelineId: "pipe-1",
      format: "joblib",
      contentAddress: "sha256:model",
      metadata: {
        source: "rt_result",
        artifactType: "native_artifact_ref",
        uri: "artifacts/model.joblib",
        backend: "joblib",
      },
    });
  });

  it("projects prediction-record model artifacts without marking aggregated refits as exportable", () => {
    const refs = buildPredictionRecordModelArtifactRefs(prediction({
      id: "pred-final-agg",
      trace_id: "chain-final",
      pipeline_uid: "pipe-1",
      fold_id: "final_agg",
      model_artifact_id: "artifact-agg",
      metric: "rmse",
    }));

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "model",
      role: "fold-model",
      label: "Final (refit) (agg) model",
      source: "prediction-record",
      chainId: "chain-final",
      pipelineId: "pipe-1",
      predictionId: "pred-final-agg",
      foldId: "final_agg",
      artifactId: "artifact-agg",
      metric: "rmse",
    });
  });

  it("describes prediction array availability as a single prediction-scoped artifact", () => {
    const arrays: PredictionArraysResponse = {
      prediction_id: "pred-1",
      y_true: [1, 2],
      y_pred: [1.1, 1.9],
      y_proba: null,
      sample_indices: [0, 1],
      weights: null,
      sample_metadata: { batch: ["a", "b"] },
      n_samples: 2,
      source_index: 3,
      source_name: "nir",
      target_index: 1,
      target_name: "protein",
      result_metadata: { dimensions: { target_index: 1 } },
    };

    expect(buildPredictionArraysArtifactRef(arrays, {
      chainId: "chain-1",
      datasetName: "dataset-a",
      metric: "rmse",
    })).toMatchObject({
      kind: "prediction_arrays",
      role: "prediction-vectors",
      source: "prediction-arrays",
      scope: "prediction",
      predictionId: "pred-1",
      chainId: "chain-1",
      datasetName: "dataset-a",
      metric: "rmse",
      metadata: {
        nSamples: 2,
        vectors: ["y_true", "y_pred", "sample_indices", "sample_metadata"],
        sourceIndex: 3,
        sourceName: "nir",
        targetIndex: 1,
        targetName: "protein",
        resultMetadata: { dimensions: { target_index: 1 } },
      },
    });
  });

  it("projects Predict available models into explicit model artifact refs", () => {
    expect(buildAvailableModelArtifactRef(availableModel({
      has_refit: true,
      fold_artifacts: {
        fold_final: "artifact-final",
        fold_0: "artifact-fold-0",
      },
    }))).toMatchObject({
      id: "available-model:chain:chain-1:artifact-final",
      kind: "model",
      role: "refit-model",
      label: "PLS",
      source: "model-inventory",
      scope: "chain",
      status: "available",
      artifactId: "artifact-final",
      chainId: "chain-1",
      bundlePath: null,
      datasetName: "dataset-a",
      metric: "rmse",
      metadata: {
        modelSource: "chain",
        modelClass: "PLSRegression",
        preprocessing: "SNV",
        hasRefit: true,
        foldArtifactKeys: ["fold_0", "fold_final"],
        bestScore: 0.12,
      },
    });

    expect(buildAvailableModelArtifactRef(availableModel({
      id: "bundle-id",
      name: "Bundle",
      source: "bundle",
      bundle_path: "opaque-bundle",
      has_refit: true,
      file_size: 123,
    }))).toMatchObject({
      id: "available-model:bundle:bundle-id:opaque-bundle",
      role: "bundle-model",
      scope: "model",
      artifactId: "opaque-bundle",
      bundlePath: "opaque-bundle",
      chainId: null,
      format: "n4a",
      metadata: {
        modelSource: "bundle",
        modelClass: "PLSRegression",
        preprocessing: "SNV",
        hasRefit: true,
        bestScore: 0.12,
        fileSize: 123,
      },
    });
  });
});
