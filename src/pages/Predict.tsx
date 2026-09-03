import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  getPersistedArchiveV2ConformalPresentation,
  predictPersistedArchiveV2Array,
  projectPersistedArchiveV2ConformalPresentation,
} from "@/api/archiveV2Prediction";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { ArchiveV2DataInput } from "@/components/predict/ArchiveV2DataInput";
import { ArchiveV2PredictionResults } from "@/components/predict/ArchiveV2PredictionResults";
import { ModelSelector } from "@/components/predict/ModelSelector";
import { Button } from "@/components/ui/button";
import {
  archiveV2SelectionIdentityEquals,
  buildArchiveV2ArrayPredictionRequest,
  readPersistedArchiveV2Selection,
} from "@/lib/archiveV2Selection";
import { motion } from "@/lib/motion";
import type {
  ArchiveV2ArrayPredictionResponse,
  ArchiveV2ConformalPresentation,
  PersistedArchiveV2Selection,
} from "@/types/archiveV2Prediction";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Predict() {
  const { t } = useTranslation();
  const [selectedModel, setSelectedModel] =
    useState<PersistedArchiveV2Selection | null>(null);
  const [result, setResult] =
    useState<ArchiveV2ArrayPredictionResponse | null>(null);
  const [conformal, setConformal] =
    useState<ArchiveV2ConformalPresentation | null>(null);
  const [conformalError, setConformalError] = useState<string | null>(null);

  const predictMutation = useMutation({
    mutationFn: async (spectra: number[][]) => {
      if (!selectedModel) throw new Error("No Archive V2 selected.");

      // Re-read the bounded contract immediately before transport. A cleared,
      // edited, moved-reference, digest, width, or target-order identity is
      // refused locally instead of being silently reinterpreted.
      const persisted = readPersistedArchiveV2Selection();
      if (
        !persisted ||
        !archiveV2SelectionIdentityEquals(selectedModel, persisted)
      ) {
        throw new Error(
          "Archive identity changed. Verify and select the persisted Archive V2 again.",
        );
      }

      const request = buildArchiveV2ArrayPredictionRequest(persisted, spectra);
      const prediction = await predictPersistedArchiveV2Array(request);
      try {
        const reference =
          await projectPersistedArchiveV2ConformalPresentation(request);
        const presentation =
          await getPersistedArchiveV2ConformalPresentation({
            schema_version: 2,
            operation: "archive_v2_conformal_presentation",
            workspace_id: persisted.workspace_id,
            archive: {
              ref: persisted.archive_ref,
              sha256: persisted.archive_sha256,
            },
            presentation_fingerprint: reference.presentation_fingerprint,
          });
        return { prediction, presentation, presentationError: null };
      } catch (error) {
        return {
          prediction,
          presentation: null,
          presentationError:
            error instanceof Error
              ? error.message
              : "No validated conformal presentation is available for this archive.",
        };
      }
    },
    onSuccess: (data) => {
      setResult(data.prediction);
      setConformal(data.presentation);
      setConformalError(data.presentationError);
      toast.success(
        `Predicted ${data.prediction.sample_ids.length} samples with ${data.prediction.archive_id}.`,
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || t("predict.errors.predictionFailed"));
    },
  });

  const handleModelSelect = useCallback(
    (model: PersistedArchiveV2Selection | null) => {
      setSelectedModel(model);
      setResult(null);
      setConformal(null);
      setConformalError(null);
      predictMutation.reset();
    },
    [predictMutation],
  );

  const handleReset = useCallback(() => {
    setResult(null);
    setConformal(null);
    setConformalError(null);
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
        <motion.div variants={itemVariants}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("predict.title")}</h1>
              <p className="text-sm text-muted-foreground">
                Native replay of an immutable persisted Archive V2.
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
              <ArchiveV2DataInput
                selection={selectedModel}
                isLoading={predictMutation.isPending}
                onRunPrediction={predictMutation.mutate}
              />

              {predictionError && (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/40 bg-destructive/10 p-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-1 h-4 w-4 text-destructive" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-destructive">
                        {t("predict.errors.predictionFailed")}
                      </p>
                      <p className="break-words text-xs text-destructive/90">
                        {predictionError.message}
                      </p>
                    </div>
                    <Button
                      type="button"
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
                <ArchiveV2PredictionResults
                  result={result}
                  conformal={conformal}
                  conformalError={conformalError}
                  onReset={handleReset}
                />
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </MlLoadingOverlay>
  );
}
