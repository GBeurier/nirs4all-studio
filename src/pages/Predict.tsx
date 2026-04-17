import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import { AlertCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { ModelSelector } from "@/components/predict/ModelSelector";
import { DataInput, type DataSourceConfig } from "@/components/predict/DataInput";
import { PredictResults, type PredictionInput } from "@/components/predict/PredictResults";
import { Button } from "@/components/ui/button";
import { runPrediction, runPredictionWithFile } from "@/api/predict";
import type { AvailableModel, PredictResponse } from "@/types/predict";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function inputFromConfig(config: DataSourceConfig): PredictionInput {
  if (config.type === "dataset") {
    return {
      type: "dataset",
      datasetId: config.datasetId,
      partition: config.partition,
    };
  }
  if (config.type === "file") {
    return { type: "file", fileName: config.file.name };
  }
  return { type: "array", rowCount: config.spectra.length };
}

export default function Predict() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [lastInput, setLastInput] = useState<PredictionInput | null>(null);
  const [preselected, setPreselected] = useState(false);

  // Deep-link: pre-select model from URL params (e.g., from ModelActionMenu)
  const urlModelId = searchParams.get("model_id");
  const urlSource = searchParams.get("source") as "chain" | "bundle" | null;

  useEffect(() => {
    if (urlModelId && urlSource && !preselected) {
      setSelectedModel({
        id: urlModelId,
        name: urlModelId,
        source: urlSource,
        model_class: "",
        dataset_name: null,
        metric: null,
        best_score: null,
        created_at: null,
        file_size: null,
        preprocessing: null,
        bundle_path: null,
        prediction_metric: null,
        prediction_score: null,
      });
      setPreselected(true);
    }
  }, [urlModelId, urlSource, preselected]);

  const predictMutation = useMutation({
    mutationFn: async (config: DataSourceConfig) => {
      if (!selectedModel) throw new Error("No model selected");

      if (config.type === "file") {
        return runPredictionWithFile(
          selectedModel.id,
          selectedModel.source,
          config.file
        );
      }

      return runPrediction({
        model_id: selectedModel.id,
        model_source: selectedModel.source,
        data_source: config.type,
        dataset_id: config.type === "dataset" ? config.datasetId : undefined,
        partition: config.type === "dataset" ? config.partition : undefined,
        spectra: config.type === "array" ? config.spectra : undefined,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(
        t("predict.results.summary", {
          count: data.num_samples,
          model: data.model_name,
        })
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || t("predict.errors.predictionFailed"));
    },
  });

  const handleRunPrediction = useCallback(
    (config: DataSourceConfig) => {
      // Capture the input context alongside the request so the results viewer
      // can display the real dataset/file/array the user ran against (not just
      // the model's training dataset name).
      setLastInput(inputFromConfig(config));
      predictMutation.mutate(config);
    },
    [predictMutation],
  );

  const handleReset = useCallback(() => {
    setResult(null);
    setLastInput(null);
    predictMutation.reset();
  }, [predictMutation]);

  const handleModelSelect = useCallback((model: AvailableModel) => {
    setSelectedModel(model);
    setResult(null);
    setLastInput(null);
    predictMutation.reset();
  }, [predictMutation]);

  const predictionError = predictMutation.error as Error | null;

  return (
    <MlLoadingOverlay>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Header */}
        <motion.div variants={itemVariants}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("predict.title")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("predict.subtitle")}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants}>
          <div className="grid gap-6 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
            <div className="xl:sticky xl:top-6 xl:self-start">
              <ModelSelector
                selectedModel={selectedModel}
                onSelect={handleModelSelect}
              />
            </div>

            <div className="space-y-6">
              <DataInput
                model={selectedModel}
                isLoading={predictMutation.isPending}
                onRunPrediction={handleRunPrediction}
              />

              {predictionError && (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/40 bg-destructive/10 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-destructive">
                        {t("predict.errors.predictionFailed")}
                      </p>
                      <p className="break-words text-xs leading-5 text-destructive/90">
                        {predictionError.message ||
                          t("predict.errors.predictionFailed")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => predictMutation.reset()}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              {result && !predictionError && (
                <PredictResults
                  result={result}
                  model={selectedModel}
                  input={lastInput}
                  onReset={handleReset}
                />
              )}
            </div>
          </div>
        </motion.div>

        {!selectedModel && (
          <motion.div variants={itemVariants}>
            <p className="text-sm text-muted-foreground">
              Choose a trained model to unlock dataset replay, file upload, or pasted spectra.
            </p>
          </motion.div>
        )}
      </motion.div>
    </MlLoadingOverlay>
  );
}
