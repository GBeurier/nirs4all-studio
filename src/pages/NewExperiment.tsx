import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { InlineError, InlineLoading, NoDatasetsState, NoPipelinesState } from "@/components/ui/state-display";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Database, Filter, GitBranch, Loader2, Play, Search, Star } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createRun, listPipelines, runPreflight } from "@/api/client";
import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import {
  analyzeSelectedPipelinesRuntimeGrouping,
  evaluateDatasetRuntimeGrouping,
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
  getRuntimeGroupingSummary,
  RUNTIME_GROUPING_COPY,
} from "@/lib/runtimeSplitGrouping";
import type { PipelineInfo } from "@/api/client";
import type { Dataset } from "@/types/datasets";
import type { ExperimentConfig } from "@/types/runs";

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };

function summarizePipelineSteps(steps: PipelineInfo["steps"]): string {
  if (!steps?.length) return "Empty pipeline";
  return steps.map((step) => step.name).join(" → ");
}

const wizardSteps = [
  { id: 1, label: "Select Pipelines", icon: GitBranch },
  { id: 2, label: "Select Datasets", icon: Database },
  { id: 3, label: "Runtime Grouping", icon: Filter },
  { id: 4, label: "Review", icon: Check },
  { id: 5, label: "Launch", icon: Play },
];

export default function NewExperiment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [customExperimentName, setCustomExperimentName] = useState("");
  const [experimentDescription, setExperimentDescription] = useState("");
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [splitGroupByByDataset, setSplitGroupByByDataset] = useState<Record<string, string | null>>({});
  const [datasetSearch, setDatasetSearch] = useState("");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState<"all" | "favorites" | "presets">("all");
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [currentEditedPipeline, setCurrentEditedPipeline] = useState<{
    id?: string;
    name: string;
    steps: unknown[];
    isDirty: boolean;
  } | null>(null);

  const { data: datasetsData, isLoading: loadingDatasets, error: datasetsError } = useDatasetsQuery();
  const { data: pipelinesData, isLoading: loadingPipelines, error: pipelinesError } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => listPipelines(),
  });

  const rawDatasets = useMemo(
    () => (datasetsData?.datasets ?? []) as Dataset[],
    [datasetsData],
  );
  const datasets = useMemo(
    () => rawDatasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name || dataset.path?.split("/").pop() || "Unknown",
      samples: dataset.num_samples || 0,
      trainSamples: dataset.train_samples,
      testSamples: dataset.test_samples,
      features: dataset.num_features || 0,
      target: dataset.default_target || dataset.targets?.[0]?.column || "Unknown",
      metadataColumns: getDatasetMetadataColumns(dataset),
      repetitionColumn: getDatasetRepetitionColumn(dataset),
      raw: dataset,
    })),
    [rawDatasets],
  );
  const rawPipelines = useMemo(
    () => (pipelinesData?.pipelines ?? []) as PipelineInfo[],
    [pipelinesData],
  );
  const pipelines = useMemo(
    () => rawPipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      preset: pipeline.category === "preset",
      favorite: pipeline.is_favorite || false,
      steps: summarizePipelineSteps(pipeline.steps),
    })),
    [rawPipelines],
  );

  const allPipelines = useMemo(() => {
    if (!currentEditedPipeline) return pipelines;
    return [{
      id: "__current_edited__",
      name: `[Current] ${currentEditedPipeline.name}${currentEditedPipeline.isDirty ? " (unsaved)" : ""}`,
      preset: false,
      favorite: false,
      steps: "Current edited pipeline from editor",
      isCurrentEdited: true,
    }, ...pipelines];
  }, [currentEditedPipeline, pipelines]);

  const datasetById = useMemo(() => new Map(datasets.map((dataset) => [dataset.id, dataset])), [datasets]);
  const selectedPipelineConfigs = useMemo(() => {
    const selected = rawPipelines
      .filter((pipeline) => selectedPipelines.includes(pipeline.id))
      .map((pipeline) => ({ id: pipeline.id, name: pipeline.name, steps: pipeline.steps as unknown[] }));
    if (selectedPipelines.includes("__current_edited__") && currentEditedPipeline) {
      selected.unshift({ id: "__current_edited__", name: currentEditedPipeline.name, steps: currentEditedPipeline.steps });
    }
    return selected;
  }, [currentEditedPipeline, rawPipelines, selectedPipelines]);

  const groupingSelection = useMemo(
    () => analyzeSelectedPipelinesRuntimeGrouping(selectedPipelineConfigs),
    [selectedPipelineConfigs],
  );
  const datasetGroupingStates = useMemo(
    () => Object.fromEntries(
      selectedDatasets
        .map((datasetId) => {
          const dataset = datasetById.get(datasetId)?.raw;
          return dataset
            ? [datasetId, evaluateDatasetRuntimeGrouping(dataset, groupingSelection, splitGroupByByDataset[datasetId] ?? null)] as const
            : null;
        })
        .filter((entry): entry is readonly [string, ReturnType<typeof evaluateDatasetRuntimeGrouping>] => Boolean(entry)),
    ),
    [datasetById, groupingSelection, selectedDatasets, splitGroupByByDataset],
  );
  const hasGroupingBlockingError =
    groupingSelection.hasPersistedGroupConflict ||
    selectedDatasets.some((datasetId) => datasetGroupingStates[datasetId]?.hasBlockingError);
  const selectedGroupingPayload = useMemo(
    () => Object.fromEntries(selectedDatasets.map((datasetId) => [datasetId, splitGroupByByDataset[datasetId] ?? null])),
    [selectedDatasets, splitGroupByByDataset],
  );

  const autoGeneratedName = useMemo(() => {
    const datasetNames = selectedDatasets.map((id) => datasetById.get(id)?.name).filter(Boolean) as string[];
    const pipelineNames = selectedPipelines.map((id) => id === "__current_edited__" ? currentEditedPipeline?.name : allPipelines.find((pipeline) => pipeline.id === id)?.name).filter(Boolean) as string[];
    if (!datasetNames.length || !pipelineNames.length) return "";
    const summarize = (names: string[]) => names.length === 1 ? names[0] : names.map((name) => name.slice(0, 4)).join("_");
    return `${summarize(datasetNames)} x ${summarize(pipelineNames)}`;
  }, [allPipelines, currentEditedPipeline, datasetById, selectedDatasets, selectedPipelines]);
  const experimentName = customExperimentName.trim() || autoGeneratedName;
  const totalRuns = selectedDatasets.length * selectedPipelines.length;

  useEffect(() => {
    if (currentStep === 4 && customExperimentName === "" && autoGeneratedName) {
      setCustomExperimentName(autoGeneratedName);
    }
  }, [autoGeneratedName, currentStep, customExperimentName]);

  useEffect(() => {
    const pipelineId = searchParams.get("pipeline");
    const source = searchParams.get("source");
    if (source === "editor") {
      try {
        const stored = sessionStorage.getItem("current-edited-pipeline");
        if (stored) {
          const data = JSON.parse(stored);
          setCurrentEditedPipeline({ id: data.id, name: data.name, steps: data.steps, isDirty: data.isDirty });
          setSelectedPipelines(["__current_edited__"]);
          toast.info(`Pipeline "${data.name}" ready for experiment`);
          sessionStorage.removeItem("current-edited-pipeline");
        }
      } catch (error) {
        console.error("Failed to load current edited pipeline:", error);
      }
      navigate("/editor", { replace: true });
    } else if (pipelineId && pipelinesData?.pipelines) {
      const exists = pipelinesData.pipelines.some((pipeline) => pipeline.id === pipelineId);
      if (exists && !selectedPipelines.includes(pipelineId)) {
        setSelectedPipelines([pipelineId]);
        const pipeline = pipelinesData.pipelines.find((candidate) => candidate.id === pipelineId);
        if (pipeline) toast.info(`Pipeline "${pipeline.name}" selected`);
      }
      navigate("/editor", { replace: true });
    }
  }, [navigate, pipelinesData, searchParams, selectedPipelines]);

  const filteredDatasets = datasets.filter((dataset) => dataset.name.toLowerCase().includes(datasetSearch.toLowerCase()));
  const filteredPipelines = allPipelines.filter((pipeline) => {
    const matchesSearch = pipeline.name.toLowerCase().includes(pipelineSearch.toLowerCase()) || pipeline.steps.toLowerCase().includes(pipelineSearch.toLowerCase());
    if ("isCurrentEdited" in pipeline && pipeline.isCurrentEdited) return matchesSearch;
    if (pipelineFilter === "favorites") return matchesSearch && pipeline.favorite;
    if (pipelineFilter === "presets") return matchesSearch && pipeline.preset;
    return matchesSearch;
  });

  const createRunMutation = useMutation({
    mutationFn: (config: ExperimentConfig) => createRun(config),
    onSuccess: (run) => {
      toast.success("Experiment started!");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${run.id}`);
    },
    onError: (error) => {
      const detail = (error as { detail?: string }).detail || (error instanceof Error ? error.message : "Unknown error");
      toast.error(`Failed to start: ${detail}`);
    },
  });

  const canProceed = () => {
    if (currentStep === 1) return selectedPipelines.length > 0;
    if (currentStep === 2) return selectedDatasets.length > 0;
    if (currentStep === 3) return !hasGroupingBlockingError;
    return true;
  };

  const toggleDataset = (id: string) => {
    setSelectedDatasets((current) => {
      const selected = current.includes(id);
      setSplitGroupByByDataset((groups) => {
        if (selected) {
          const next = { ...groups };
          delete next[id];
          return next;
        }
        return id in groups ? groups : { ...groups, [id]: null };
      });
      return selected ? current.filter((datasetId) => datasetId !== id) : [...current, id];
    });
  };

  const togglePipeline = (id: string) => {
    setSelectedPipelines((current) => current.includes(id) ? current.filter((pipelineId) => pipelineId !== id) : [...current, id]);
  };

  const handleLaunch = async () => {
    if (hasGroupingBlockingError) {
      toast.error("Resolve runtime grouping errors before launching this experiment.");
      setCurrentStep(3);
      return;
    }
    const regularPipelineIds = selectedPipelines.filter((id) => id !== "__current_edited__");
    const inlinePipeline = selectedPipelines.includes("__current_edited__") && currentEditedPipeline
      ? { name: currentEditedPipeline.name, steps: currentEditedPipeline.steps }
      : undefined;
    try {
      setIsPreflighting(true);
      const preflight = await runPreflight(regularPipelineIds, inlinePipeline);
      if (!preflight.ready) {
        toast.error("Cannot start experiment", { description: preflight.issues.map((issue) => issue.message).join("\n") });
        return;
      }
    } catch {
      toast.warning("Preflight check unavailable — dependency verification was skipped");
    } finally {
      setIsPreflighting(false);
    }
    createRunMutation.mutate({
      name: experimentName,
      description: experimentDescription || undefined,
      dataset_ids: selectedDatasets,
      pipeline_ids: regularPipelineIds,
      inline_pipeline: inlinePipeline,
      split_group_by_by_dataset: selectedGroupingPayload,
    });
  };

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      <motion.div variants={itemVariants} className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/runs")}><ArrowLeft className="h-4 w-4" /></Button>
        <div><h1 className="text-2xl font-bold tracking-tight">New Experiment</h1><p className="text-muted-foreground">Create and launch pipeline experiments</p></div>
      </motion.div>
      <motion.div variants={itemVariants} className="mx-auto flex max-w-4xl items-center justify-between">
        {wizardSteps.map((step, index) => {
          const StepIcon = step.icon;
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          return <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors", isActive ? "border-primary bg-primary text-primary-foreground" : isCompleted ? "border-chart-1 bg-chart-1 text-primary-foreground" : "border-border bg-card text-muted-foreground")}>
                {isCompleted ? <Check className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
              </div>
              <span className={cn("mt-2 text-xs", isActive ? "font-medium text-foreground" : "text-muted-foreground")}>{step.label}</span>
            </div>
            {index < wizardSteps.length - 1 && <div className={cn("mx-2 h-0.5 w-16", isCompleted ? "bg-chart-1" : "bg-border")} />}
          </div>;
        })}
      </motion.div>
      <motion.div variants={itemVariants}>
        <Card className="mx-auto max-w-4xl"><CardContent className="p-6">
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Select Pipelines</h2>
                <Badge variant="secondary">{selectedPipelines.length} selected</Badge>
              </div>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search pipelines..." value={pipelineSearch} onChange={(event) => setPipelineSearch(event.target.value)} className="pl-9" />
                </div>
                <Select value={pipelineFilter} onValueChange={(value: "all" | "favorites" | "presets") => setPipelineFilter(value)}>
                  <SelectTrigger className="w-40"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Pipelines</SelectItem>
                    <SelectItem value="favorites">Favorites</SelectItem>
                    <SelectItem value="presets">Presets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loadingPipelines && <InlineLoading message="Loading pipelines..." />}
              {pipelinesError && <InlineError message={pipelinesError instanceof Error ? pipelinesError.message : "Failed to load pipelines"} />}
              {!loadingPipelines && !pipelinesError && pipelines.length === 0 && (
                <NoPipelinesState title="No pipelines available" description="Create a pipeline in the Pipeline Editor first." actionLabel="Create Pipeline" actionPath="/pipelines/new" />
              )}
              {!loadingPipelines && !pipelinesError && pipelines.length > 0 && (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {filteredPipelines.map((pipeline) => (
                    <div key={pipeline.id} onClick={() => togglePipeline(pipeline.id)} className={cn("cursor-pointer rounded-lg border p-4 transition-colors", selectedPipelines.includes(pipeline.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
                      <div className="flex items-center gap-3">
                        <Checkbox checked={selectedPipelines.includes(pipeline.id)} onCheckedChange={() => togglePipeline(pipeline.id)} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">{pipeline.name}</p>
                            {pipeline.favorite && <Star className="h-3 w-3 fill-chart-2 text-chart-2" />}
                            {pipeline.preset && <Badge variant="outline" className="text-xs">Preset</Badge>}
                          </div>
                          <code className="text-sm text-muted-foreground">{pipeline.steps}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredPipelines.length === 0 && pipelineSearch && <div className="py-4 text-center text-muted-foreground">No pipelines match "{pipelineSearch}"</div>}
                </div>
              )}
            </div>
          )}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Select Datasets</h2>
                <Badge variant="secondary">{selectedDatasets.length} selected</Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search datasets..." value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} className="pl-9" />
              </div>
              {loadingDatasets && <InlineLoading message="Loading datasets..." />}
              {datasetsError && <InlineError message={datasetsError instanceof Error ? datasetsError.message : "Failed to load datasets"} />}
              {!loadingDatasets && !datasetsError && datasets.length === 0 && (
                <NoDatasetsState title="No datasets available" description="Link a workspace with datasets in Settings, or import a dataset." actionLabel="Go to Settings" actionPath="/settings" />
              )}
              {!loadingDatasets && !datasetsError && datasets.length > 0 && (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {filteredDatasets.map((dataset) => (
                    <div key={dataset.id} onClick={() => toggleDataset(dataset.id)} className={cn("cursor-pointer rounded-lg border p-4 transition-colors", selectedDatasets.includes(dataset.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
                      <div className="flex items-center gap-3">
                        <Checkbox checked={selectedDatasets.includes(dataset.id)} onCheckedChange={() => toggleDataset(dataset.id)} />
                        <div className="flex-1 space-y-1">
                          <p className="font-medium text-foreground">{dataset.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {dataset.samples} samples
                            {dataset.testSamples != null && dataset.testSamples > 0 && (
                              <span className="ml-1 tabular-nums">({dataset.trainSamples?.toLocaleString() ?? "—"} train · {dataset.testSamples.toLocaleString()} test)</span>
                            )}
                            {" • "}{dataset.features} features • Target: {dataset.target}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Metadata: {dataset.metadataColumns.length || 0} columns</span>
                            {dataset.repetitionColumn && <span>Repetition: {dataset.repetitionColumn}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredDatasets.length === 0 && datasetSearch && <div className="py-4 text-center text-muted-foreground">No datasets match "{datasetSearch}"</div>}
                </div>
              )}
            </div>
          )}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Runtime Grouping</h2>
                <Badge variant="secondary">{selectedDatasets.length} dataset{selectedDatasets.length > 1 ? "s" : ""}</Badge>
              </div>
              {!groupingSelection.hasSplitters && <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">{RUNTIME_GROUPING_COPY.noSplitterRun}</div>}
              {groupingSelection.hasPersistedGroupConflict && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-destructive">{RUNTIME_GROUPING_COPY.conflictTitle}</p>
                      <p className="text-muted-foreground">{RUNTIME_GROUPING_COPY.conflictDescription}</p>
                      {groupingSelection.conflictingPipelines.map((pipeline) => <p key={pipeline.id} className="text-xs text-muted-foreground">{pipeline.name}: {pipeline.steps.join(", ")}</p>)}
                    </div>
                  </div>
                </div>
              )}
              {groupingSelection.hasSplitters && !groupingSelection.hasPersistedGroupConflict && (
                <div className="space-y-3">
                  {selectedDatasets.map((datasetId) => {
                    const dataset = datasetById.get(datasetId);
                    const groupingState = datasetGroupingStates[datasetId];
                    if (!dataset || !groupingState) return null;
                    return (
                      <div key={datasetId} className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-foreground">{dataset.name}</p>
                            <p className="text-sm text-muted-foreground">{dataset.metadataColumns.length || 0} metadata columns</p>
                          </div>
                          {groupingState.requiresExplicitGroup ? <Badge variant="destructive">Required</Badge> : groupingSelection.hasRequiredSplitters ? <Badge variant="outline">Optional with repetition</Badge> : <Badge variant="outline">Optional</Badge>}
                        </div>
                        <Select value={splitGroupByByDataset[datasetId] ?? "__none__"} onValueChange={(value) => setSplitGroupByByDataset((current) => ({ ...current, [datasetId]: value === "__none__" ? null : value }))}>
                          <SelectTrigger><SelectValue placeholder="Select metadata column..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No additional group</SelectItem>
                            {groupingState.metadataColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <p className="text-xs leading-relaxed text-muted-foreground">{RUNTIME_GROUPING_COPY.additiveDescription}</p>
                        {groupingState.repetitionColumn && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">Dataset repetition</Badge><code>{groupingState.repetitionColumn}</code></div>}
                        <p className="text-[11px] leading-relaxed text-muted-foreground">{RUNTIME_GROUPING_COPY.legacyGroupDeprecation}</p>
                        {groupingState.hasBlockingError && <p className="text-xs text-destructive">{groupingState.blockingMessage}</p>}
                        {groupingState.repetitionOnlyWarning && <p className="text-xs text-amber-700 dark:text-amber-400">{groupingState.repetitionOnlyWarning}</p>}
                        {groupingState.optionalPropagationWarning && <p className="text-xs text-amber-700 dark:text-amber-400">{groupingState.optionalPropagationWarning}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-foreground">Review Experiment</h2>
              <Card className="bg-muted/30"><CardContent className="space-y-4 p-4">
                <div>
                  <label className="text-sm text-muted-foreground">Experiment Name</label>
                  <Input value={customExperimentName} onChange={(event) => setCustomExperimentName(event.target.value)} placeholder={autoGeneratedName} className="mt-1" />
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Datasets</span><p className="font-semibold text-foreground">{selectedDatasets.length}</p></div>
                  <div><span className="text-muted-foreground">Pipelines</span><p className="font-semibold text-foreground">{selectedPipelines.length}</p></div>
                  <div><span className="text-muted-foreground">Total Runs</span><p className="font-semibold text-foreground">{totalRuns}</p></div>
                </div>
              </CardContent></Card>
              <div>
                <label className="text-sm font-medium text-foreground">Description (optional)</label>
                <Textarea value={experimentDescription} onChange={(event) => setExperimentDescription(event.target.value)} placeholder="Add notes about this experiment..." className="mt-1.5" rows={2} />
              </div>
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Runtime Grouping Summary</h3>
                  {!groupingSelection.hasSplitters && <Badge variant="outline">No splitters</Badge>}
                </div>
                {!groupingSelection.hasSplitters ? <p className="text-sm text-muted-foreground">{RUNTIME_GROUPING_COPY.noSplitterInjection}</p> : (
                  <div className="space-y-2">
                    {selectedDatasets.map((datasetId) => {
                      const dataset = datasetById.get(datasetId);
                      const groupingState = datasetGroupingStates[datasetId];
                      if (!dataset || !groupingState) return null;
                      const summary = getRuntimeGroupingSummary(
                        groupingState.repetitionColumn,
                        groupingState.selectedGroupBy,
                      );
                      return <div key={datasetId} className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm"><span className="font-medium text-foreground">{dataset.name}</span><span className="text-muted-foreground">{summary}</span></div>;
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          {currentStep === 5 && (
            <div className="space-y-6 py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"><Play className="h-8 w-8 text-primary" /></div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">{experimentName}</h2>
                {experimentDescription && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{experimentDescription}</p>}
                <p className="mt-2 text-muted-foreground">{totalRuns} runs across {selectedDatasets.length} datasets and {selectedPipelines.length} pipelines</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {selectedDatasets.map((datasetId) => <Badge key={datasetId} variant="secondary">{datasetById.get(datasetId)?.name || datasetId}</Badge>)}
              </div>
              <Button size="lg" onClick={handleLaunch} disabled={createRunMutation.isPending || isPreflighting}>
                {isPreflighting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking...</> : createRunMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting...</> : <><Play className="mr-2 h-4 w-4" />Launch Experiment</>}
              </Button>
            </div>
          )}
        </CardContent></Card>
      </motion.div>
      {currentStep < 5 && (
        <motion.div variants={itemVariants} className="mx-auto flex max-w-4xl justify-between">
          <Button variant="outline" onClick={() => setCurrentStep((step) => Math.max(1, step - 1))} disabled={currentStep === 1}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
          <Button onClick={() => setCurrentStep((step) => Math.min(5, step + 1))} disabled={!canProceed()}>Next<ArrowRight className="ml-2 h-4 w-4" /></Button>
        </motion.div>
      )}
    </motion.div>
  );
}
