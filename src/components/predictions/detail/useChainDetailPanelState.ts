import { useEffect, useMemo, useState } from "react";
import { buildCanonicalPreviewSteps } from "@/lib/canonicalPipelinePreview";
import { computePipelineStats } from "@/lib/pipelineStats";
import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import {
  getChainDetail,
  getChainPartitionDetail,
  getChainPipelineSteps,
  getPredictionArrays,
} from "@/api/aggregatedPredictions";
import type {
  ChainDetailResponse,
  ChainSummary,
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";
import type { ScoreCardType } from "@/types/score-cards";
import { usePartitionsData } from "@/components/predictions/viewer/fetchPartitionData";
import { usePredictionChartConfig } from "@/components/predictions/viewer/usePredictionChartConfig";
import {
  buildFoldModelArtifactRefs,
  buildPredictionArraysArtifactRef,
  buildResultArtifactPresentationReadModel,
  buildResultArtifactSourceScopeGroupItems,
  buildResultArtifactSourceScopeReadModel,
  type ResultArtifactRef,
} from "@/lib/resultArtifacts";
import type {
  ChartConfig,
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import {
  buildCvMetricRows,
  buildFoldGroups,
  buildPipelineTreeWithParams,
  formatBranchPath,
  parseGeneratorChoices,
  parseRecord,
  resolveInitialFoldId,
  resolvePrimaryCvMetric,
  residualSummary,
  summarize,
} from "./chainDetailData";

/** Lightweight metadata used to render the header before the ChainSummary
 *  fetch resolves (avoids a blank header during the opening animation). */
export interface ChainDetailMetaHint {
  modelName?: string | null;
  modelClass?: string | null;
  datasetName?: string | null;
  metric?: string | null;
  taskType?: string | null;
  preprocessings?: string | null;
  pipelineStatus?: string | null;
}

export interface ChainDetailFocus {
  cardType?: ScoreCardType | null;
  foldId?: string | null;
  predictionId?: string | null;
}

type OpenViewerHandler = (
  partitions: ViewerPartitionTarget[],
  header: ViewerHeader,
  kind: ChartKind,
) => void;

export interface ChainDetailArtifactSummaryCount {
  id: string;
  label: string;
  artifactCount: number;
  artifactCountLabel: string;
}

export interface ChainDetailArtifactProvenanceGroup {
  id: string;
  label: string;
  sourceLabel: string;
  scopeLabel: string;
  artifactCount: number;
  artifactCountLabel: string;
  artifactLabels: string[];
}

export interface ChainDetailArtifactSummary {
  refs: ResultArtifactRef[];
  totalCount: number;
  totalCountLabel: string;
  kindItems: ChainDetailArtifactSummaryCount[];
  statusItems: ChainDetailArtifactSummaryCount[];
  provenanceGroups: ChainDetailArtifactProvenanceGroup[];
}

interface UseChainDetailPanelStateOptions {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  focus?: ChainDetailFocus;
  onOpenViewer?: OpenViewerHandler;
}

export function useChainDetailPanelState({
  chainId,
  metric,
  metaHint,
  focus,
  onOpenViewer,
}: UseChainDetailPanelStateOptions) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedFoldId, setSelectedFoldId] = useState<string>("");
  const [arrayData, setArrayData] = useState<PredictionArraysResponse | null>(null);
  const [loadingArrays, setLoadingArrays] = useState(false);
  const [previewKind, setPreviewKind] = useState<ChartKind>("scatter");
  const [pipelineSteps, setPipelineSteps] = useState<unknown[] | null>(null);

  const prediction = useMemo<ChainSummary>(() => {
    const summary = detail?.summary;
    if (summary) return summary;
    const stub: ChainSummary = {
      run_id: "",
      pipeline_id: "",
      chain_id: chainId,
      model_name: metaHint?.modelName ?? null,
      model_class: metaHint?.modelClass ?? "",
      preprocessings: metaHint?.preprocessings ?? null,
      branch_path: null,
      source_index: null,
      model_step_idx: 0,
      metric: metaHint?.metric ?? metric ?? null,
      task_type: metaHint?.taskType ?? null,
      dataset_name: metaHint?.datasetName ?? null,
      best_params: null,
      cv_val_score: null,
      cv_test_score: null,
      cv_train_score: null,
      cv_fold_count: 0,
      cv_scores: null,
      final_test_score: null,
      final_train_score: null,
      final_scores: null,
      pipeline_status: metaHint?.pipelineStatus ?? null,
      fold_artifacts: null,
    };
    return stub;
  }, [detail, chainId, metric, metaHint]);

  const configDatasetKey = useMemo(
    () => `__current__::${prediction.dataset_name}`,
    [prediction.dataset_name],
  );
  const [sharedConfig] = usePredictionChartConfig({ datasetKey: configDatasetKey });
  const panelConfig = useMemo<ChartConfig>(
    () => ({
      ...sharedConfig,
      regressionLine: false,
      sigmaBand: false,
      confusionShowTotals: true,
    }),
    [sharedConfig],
  );

  const taskKind: "regression" | "classification" = useMemo(
    () => (isClassificationTask(prediction.task_type) ? "classification" : "regression"),
    [prediction.task_type],
  );

  useEffect(() => {
    setPreviewKind((current) => {
      if (taskKind === "classification") {
        return current === "confusion" || current === "distribution" ? current : "confusion";
      }
      return current === "confusion" ? "scatter" : current;
    });
  }, [taskKind]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSummary(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(chainId, {
            metric: metric ?? undefined,
            dataset_name: metaHint?.datasetName ?? undefined,
          }),
          getChainPartitionDetail(chainId),
        ]);
        if (cancelled) return;
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
      } catch (err) {
        if (!cancelled) console.error("Failed to load chain detail:", err);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chainId, metric, metaHint?.datasetName]);

  useEffect(() => {
    let cancelled = false;
    setPipelineSteps(null);
    getChainPipelineSteps(chainId)
      .then((result) => {
        if (!cancelled) setPipelineSteps(Array.isArray(result?.pipeline) ? result.pipeline : []);
      })
      .catch(() => {
        if (!cancelled) setPipelineSteps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  useEffect(() => {
    if (partitionRows.length === 0) return;
    setSelectedFoldId((current) => current && partitionRows.some((row) => row.fold_id === current)
      ? current
      : resolveInitialFoldId(partitionRows, focus, prediction));
  }, [partitionRows, focus, prediction]);

  const foldGroups = useMemo(() => buildFoldGroups(partitionRows), [partitionRows]);
  const selectedGroup = useMemo(
    () => foldGroups.find((group) => group.foldId === selectedFoldId) ?? null,
    [foldGroups, selectedFoldId],
  );
  const selectedPrediction = selectedGroup?.representative ?? null;
  const selectedFoldPartitions = useMemo(
    () => selectedGroup?.rows ?? [],
    [selectedGroup],
  );

  useEffect(() => {
    if (!selectedPrediction) {
      setArrayData(null);
      return;
    }
    const predictionId = selectedPrediction.prediction_id;
    let cancelled = false;
    async function run() {
      setLoadingArrays(true);
      try {
        const data = await getPredictionArrays(predictionId);
        if (!cancelled) setArrayData(data);
      } catch {
        if (!cancelled) setArrayData(null);
      } finally {
        if (!cancelled) setLoadingArrays(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrediction]);

  const chartTargets = useMemo<ViewerPartitionTarget[]>(
    () => selectedFoldPartitions.map((predictionRow) => ({
      predictionId: predictionRow.prediction_id,
      partition: (predictionRow.partition ?? "").toLowerCase(),
      label: predictionRow.partition ?? "",
      source: "aggregated" as const,
    })),
    [selectedFoldPartitions],
  );

  const chartHeader = useMemo<ViewerHeader | null>(() => {
    if (!selectedPrediction) return null;
    return {
      datasetName: selectedPrediction.dataset_name ?? prediction.dataset_name ?? "",
      modelName: selectedPrediction.model_name ?? prediction.model_name ?? null,
      preprocessings: selectedPrediction.preprocessings ?? prediction.preprocessings ?? null,
      foldId: selectedPrediction.fold_id ?? null,
      taskType: selectedPrediction.task_type ?? prediction.task_type ?? null,
      valScore: selectedPrediction.val_score ?? null,
      testScore: selectedPrediction.test_score ?? null,
      trainScore: selectedPrediction.train_score ?? null,
      nSamples: selectedPrediction.n_samples ?? null,
      nFeatures: selectedPrediction.n_features ?? null,
    };
  }, [selectedPrediction, prediction]);

  const { data: chartDatasets, isLoading: chartsLoading, error: chartsError } = usePartitionsData({
    partitions: chartTargets,
    enabled: chartTargets.length > 0,
  });

  const handleCustomize = (kind: ChartKind) => {
    if (!chartHeader || chartTargets.length === 0) return;
    onOpenViewer?.(chartTargets, chartHeader, kind);
  };
  const canCustomize = !!onOpenViewer && !!chartHeader && chartTargets.length > 0;
  const chartBodyKey = `${previewKind}:${selectedGroup?.foldId ?? "none"}:${chartTargets.map((target) => target.predictionId).join("|")}`;

  const preprocessLabel = prediction.preprocessings || "None";
  const variantParams = useMemo(() => {
    const parsed = parseRecord(prediction.variant_params);
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  }, [prediction.variant_params]);
  const bestParams = useMemo(() => {
    const fromSummary = parseRecord(prediction.best_params);
    if (fromSummary && Object.keys(fromSummary).length > 0) return fromSummary;
    const selectedRows = selectedGroup?.rows ?? [];
    for (const row of [...selectedRows, ...partitionRows]) {
      const candidate = parseRecord(row.best_params);
      if (candidate && Object.keys(candidate).length > 0) return candidate;
    }
    return null;
  }, [prediction.best_params, selectedGroup, partitionRows]);

  const previewPipelineSteps = useMemo(() => {
    if (!pipelineSteps || pipelineSteps.length === 0) return null;
    return buildCanonicalPreviewSteps(pipelineSteps);
  }, [pipelineSteps]);
  const pipelineStats = useMemo(
    () => (previewPipelineSteps ? computePipelineStats(previewPipelineSteps) : null),
    [previewPipelineSteps],
  );
  const pipelineTree = useMemo(
    () => (previewPipelineSteps ? buildPipelineTreeWithParams(previewPipelineSteps, 24) : null),
    [previewPipelineSteps],
  );

  const generatorChoices = useMemo(
    () => parseGeneratorChoices(detail?.pipeline?.generator_choices),
    [detail?.pipeline?.generator_choices],
  );
  const branchPathLabel = useMemo(() => formatBranchPath(prediction.branch_path), [prediction.branch_path]);

  const vectorSummaries = useMemo(
    () => chartDatasets.map((dataset) => ({
      dataset,
      observed: summarize(dataset.yTrue),
      predicted: summarize(dataset.yPred),
      residuals: residualSummary(dataset.yTrue, dataset.yPred),
    })),
    [chartDatasets],
  );

  const arrayArtifactRef = useMemo(
    () => arrayData
      ? buildPredictionArraysArtifactRef(arrayData, {
        runId: prediction.run_id,
        pipelineId: selectedPrediction?.pipeline_id ?? prediction.pipeline_id,
        chainId: selectedPrediction?.chain_id ?? prediction.chain_id,
        datasetName: selectedPrediction?.dataset_name ?? prediction.dataset_name,
        metric: selectedPrediction?.metric ?? prediction.metric,
      })
      : null,
    [arrayData, prediction, selectedPrediction],
  );

  const artifactSummary = useMemo<ChainDetailArtifactSummary>(() => {
    const refs = [
      ...buildFoldModelArtifactRefs(prediction.fold_artifacts, {
        runId: prediction.run_id,
        pipelineId: selectedPrediction?.pipeline_id ?? prediction.pipeline_id,
        chainId: prediction.chain_id,
        datasetName: prediction.dataset_name,
        metric: prediction.metric,
      }),
      ...(arrayArtifactRef ? [arrayArtifactRef] : []),
    ];
    const presentation = buildResultArtifactPresentationReadModel(refs);
    const provenance = buildResultArtifactSourceScopeReadModel(refs);

    return {
      refs: presentation.refs,
      totalCount: presentation.totalArtifactCount,
      totalCountLabel: presentation.totalArtifactCountLabel,
      kindItems: presentation.kindItems.map((item) => ({
        id: item.id,
        label: item.label,
        artifactCount: item.artifactCount,
        artifactCountLabel: item.artifactCountLabel,
      })),
      statusItems: presentation.statusItems.map((item) => ({
        id: item.id,
        label: item.label,
        artifactCount: item.artifactCount,
        artifactCountLabel: item.artifactCountLabel,
      })),
      provenanceGroups: buildResultArtifactSourceScopeGroupItems(provenance.groups).map((group) => ({
        id: group.id,
        label: group.label,
        sourceLabel: group.sourceLabel,
        scopeLabel: group.scopeLabel,
        artifactCount: group.artifactCount,
        artifactCountLabel: group.artifactCountLabel,
        artifactLabels: group.refs.map((ref) => ref.label),
      })),
    };
  }, [arrayArtifactRef, prediction, selectedPrediction]);

  const cvMetricRows = useMemo(
    () => buildCvMetricRows(prediction.cv_scores, prediction.metric),
    [prediction.cv_scores, prediction.metric],
  );
  const primaryCvMetric = useMemo(
    () => resolvePrimaryCvMetric(prediction.metric, cvMetricRows),
    [prediction.metric, cvMetricRows],
  );
  const additionalCvMetricRows = useMemo(
    () => cvMetricRows.filter((row) => row.metric !== primaryCvMetric),
    [cvMetricRows, primaryCvMetric],
  );

  return {
    detail,
    prediction,
    loadingSummary,
    selectedFoldId,
    setSelectedFoldId,
    previewKind,
    setPreviewKind,
    panelConfig,
    taskKind,
    foldGroups,
    selectedGroup,
    selectedPrediction,
    selectedFoldPartitions,
    chartTargets,
    chartDatasets,
    chartsLoading,
    chartsError,
    canCustomize,
    handleCustomize,
    chartBodyKey,
    preprocessLabel,
    variantParams,
    bestParams,
    pipelineStats,
    pipelineTree,
    generatorChoices,
    branchPathLabel,
    vectorSummaries,
    arrayData,
    arrayArtifactRef,
    artifactSummary,
    loadingArrays,
    additionalCvMetricRows,
  };
}
