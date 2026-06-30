/**
 * PredictDialog - Make predictions using a trained model (Predict A implementation)
 *
 * This dialog allows users to:
 * - Select input data (upload file, paste CSV, or select from dataset)
 * - Preview input data
 * - Run prediction with selected model
 * - View and export results
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/transport";
import { PredictDialogInput } from "./PredictDialogInput";
import { PredictDialogResults } from "./PredictDialogResults";
import {
  buildPredictionCsv,
  parsePredictionCsvInput,
  type PredictInputMode,
  type PredictionResult,
} from "./PredictDialogData";

// ============================================================================
// Types
// ============================================================================

export interface PredictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  modelName: string;
  pipelineId?: string;
  pipelineName?: string;
  runId?: string;
}

// ============================================================================
// Main Component
// ============================================================================

export function PredictDialog({
  open,
  onOpenChange,
  modelId,
  modelName,
  pipelineId,
  pipelineName,
  runId,
}: PredictDialogProps) {
  const [inputMode, setInputMode] = useState<PredictInputMode>("paste");
  const [pasteData, setPasteData] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [selectedPartition, setSelectedPartition] = useState("test");
  const [result, setResult] = useState<PredictionResult | null>(null);

  // Reset state when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setPasteData("");
      setSelectedDataset("");
      setResult(null);
    }
    onOpenChange(open);
  };

  // Batch prediction mutation
  const batchPredictMutation = useMutation({
    mutationFn: async (spectra: number[][]) => {
      return api.post<PredictionResult>("/predictions/batch", {
        model_id: modelId,
        spectra,
        preprocessing_chain: [],
        save_results: true,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(`${data.num_samples} predictions completed`);
    },
    onError: (err: Error) => {
      toast.error(`Prediction failed: ${err.message}`);
    },
  });

  // Dataset prediction mutation
  const datasetPredictMutation = useMutation({
    mutationFn: async () => {
      return api.post<PredictionResult>("/predictions/dataset", {
        model_id: modelId,
        dataset_id: selectedDataset,
        partition: selectedPartition,
        preprocessing_chain: [],
        save_results: true,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(`${data.num_samples} predictions completed`);
    },
    onError: (err: Error) => {
      toast.error(`Prediction failed: ${err.message}`);
    },
  });

  const handlePredict = () => {
    if (inputMode === "dataset") {
      if (!selectedDataset) {
        toast.error("Please select a dataset");
        return;
      }
      datasetPredictMutation.mutate();
    } else {
      const spectra = parsePredictionCsvInput(pasteData);
      if (spectra.length === 0) {
        toast.error("No valid spectral data found");
        return;
      }
      batchPredictMutation.mutate(spectra);
    }
  };

  const handleExport = () => {
    if (!result) return;

    const csv = buildPredictionCsv(result);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `predictions_${modelId}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Predictions exported");
  };

  const isLoading = batchPredictMutation.isPending || datasetPredictMutation.isPending;

  const canPredict =
    (inputMode === "dataset" && selectedDataset) ||
    (inputMode !== "dataset" && pasteData.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Make Predictions
          </DialogTitle>
          <DialogDescription>
            Using model: <code className="text-xs bg-muted px-1 py-0.5 rounded">{modelName}</code>
            {pipelineName && (
              <span className="text-muted-foreground ml-2">
                from {pipelineName}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <PredictDialogResults result={result} onExport={handleExport} />
        ) : (
          <PredictDialogInput
            inputMode={inputMode}
            onInputModeChange={setInputMode}
            pasteData={pasteData}
            onPasteDataChange={setPasteData}
            selectedDataset={selectedDataset}
            onDatasetSelect={setSelectedDataset}
            selectedPartition={selectedPartition}
            onPartitionChange={setSelectedPartition}
          />
        )}

        <DialogFooter className="gap-2">
          {result ? (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>
                New Prediction
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handlePredict} disabled={!canPredict || isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Predicting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Predict
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PredictDialog;
