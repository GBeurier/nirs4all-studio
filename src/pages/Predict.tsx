import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { ModelSelector } from "@/components/predict/ModelSelector";
import { DataInput, type DataSourceConfig } from "@/components/predict/DataInput";
import { PredictResults } from "@/components/predict/PredictResults";
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

export default function Predict() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);
  const [result, setResult] = useState<PredictResponse | null>(null);
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
      predictMutation.mutate(config);
    },
    [predictMutation]
  );

  const handleReset = useCallback(() => {
    setResult(null);
  }, []);

  const handleModelSelect = useCallback((model: AvailableModel) => {
    setSelectedModel(model);
    setResult(null);
  }, []);

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
              <p className="text-sm text-muted-foreground">{t("predict.subtitle")}</p>
            </div>
          </div>
        </motion.div>

        {/* Step 1: Model Selection */}
        <motion.div variants={itemVariants}>
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={handleModelSelect}
          />
        </motion.div>

        {/* Step 2: Data Input (shown after model is selected) */}
        {selectedModel && !result && (
          <motion.div variants={itemVariants}>
            <DataInput
              model={selectedModel}
              isLoading={predictMutation.isPending}
              onRunPrediction={handleRunPrediction}
            />
          </motion.div>
        )}

        {/* Step 3: Results (shown after prediction completes) */}
        {result && (
          <motion.div variants={itemVariants}>
            <PredictResults result={result} onReset={handleReset} />
          </motion.div>
        )}
      </motion.div>
    </MlLoadingOverlay>
  );
}
