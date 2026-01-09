/**
 * PredictDialog - Make predictions using a trained model (Predict A implementation)
 *
 * This dialog allows users to:
 * - Select input data (upload file, paste CSV, or select from dataset)
 * - Preview input data
 * - Run prediction with selected model
 * - View and export results
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileSpreadsheet,
  Database,
  Play,
  Download,
  Copy,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api, listDatasets } from "@/api/client";

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

interface PredictionResult {
  predictions: number[];
  model_id: string;
  num_samples: number;
  preprocessing_applied: string[];
  actual_values?: number[];
  metrics?: {
    r2?: number;
    rmse?: number;
    mae?: number;
  };
}

type InputMode = "paste" | "upload" | "dataset";

// ============================================================================
// Helper Functions
// ============================================================================

function parseCSV(text: string): number[][] {
  const lines = text.trim().split("\n");
  const data: number[][] = [];

  for (const line of lines) {
    // Skip header rows that contain non-numeric data
    const values = line.split(/[,;\t]/).map((v) => v.trim());
    const numericValues = values.map((v) => parseFloat(v));

    if (numericValues.every((v) => !isNaN(v))) {
      data.push(numericValues);
    }
  }

  return data;
}

function formatPrediction(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(1);
  }
  return value.toFixed(4);
}

// ============================================================================
// Subcomponents
// ============================================================================

function PasteInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Paste spectrum data (CSV format)</Label>
      <Textarea
        placeholder="Paste comma or tab-separated spectral values...&#10;&#10;Example:&#10;0.123, 0.456, 0.789, ...&#10;0.234, 0.567, 0.890, ..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[200px] font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        One spectrum per line. Values separated by comma, semicolon, or tab.
      </p>
    </div>
  );
}

function FileUpload({
  onFileLoad,
}: {
  onFileLoad: (data: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(csv|txt|tsv)$/i)) {
        toast.error("Please upload a CSV, TXT, or TSV file");
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setFileName(file.name);
        onFileLoad(text);
      };
      reader.readAsText(file);
    },
    [onFileLoad]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-2">
      <Label>Upload spectrum file</Label>
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
          fileName && "border-chart-1 bg-chart-1/5"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".csv,.txt,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {fileName ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle2 className="h-8 w-8 text-chart-1" />
            <p className="font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">Click to change file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Drop file here or click to upload</p>
            <p className="text-xs text-muted-foreground">
              Supports CSV, TXT, TSV files
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetSelector({
  selectedDataset,
  onSelect,
  selectedPartition,
  onPartitionChange,
}: {
  selectedDataset: string;
  onSelect: (id: string) => void;
  selectedPartition: string;
  onPartitionChange: (partition: string) => void;
}) {
  const { data: datasetsData, isLoading } = useQuery({
    queryKey: ["datasets-for-predict"],
    queryFn: () => listDatasets(false),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Select dataset</Label>
        <Select value={selectedDataset} onValueChange={onSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a dataset..." />
          </SelectTrigger>
          <SelectContent>
            {isLoading ? (
              <div className="p-2 text-sm text-muted-foreground">Loading...</div>
            ) : !datasetsData?.datasets?.length ? (
              <div className="p-2 text-sm text-muted-foreground">No datasets available</div>
            ) : (
              datasetsData.datasets.map((ds) => (
                <SelectItem key={ds.id} value={ds.id}>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>{ds.name}</span>
                    {ds.num_samples && (
                      <Badge variant="secondary" className="text-xs">
                        {ds.num_samples} samples
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {selectedDataset && (
        <div className="space-y-2">
          <Label>Partition</Label>
          <Select value={selectedPartition} onValueChange={onPartitionChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">Test</SelectItem>
              <SelectItem value="train">Train</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function ResultsDisplay({
  result,
  onExport,
}: {
  result: PredictionResult;
  onExport: () => void;
}) {
  const hasActual = result.actual_values && result.actual_values.length > 0;
  const displayCount = Math.min(result.predictions.length, 20);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-chart-1" />
            <span className="font-medium">{result.num_samples} predictions</span>
          </div>
          {result.metrics && (
            <div className="flex items-center gap-3 text-sm">
              {result.metrics.r2 !== undefined && (
                <Badge variant="outline" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  R² = {(result.metrics.r2 * 100).toFixed(2)}%
                </Badge>
              )}
              {result.metrics.rmse !== undefined && (
                <Badge variant="outline">
                  RMSE = {result.metrics.rmse.toFixed(4)}
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Results table */}
      <Card>
        <ScrollArea className="h-64">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Prediction</TableHead>
                {hasActual && <TableHead>Actual</TableHead>}
                {hasActual && <TableHead>Difference</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.predictions.slice(0, displayCount).map((pred, idx) => {
                const actual = hasActual ? result.actual_values![idx] : null;
                const diff = actual !== null ? pred - actual : null;
                return (
                  <TableRow key={idx}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-mono">{formatPrediction(pred)}</TableCell>
                    {hasActual && (
                      <TableCell className="font-mono">
                        {actual !== null ? formatPrediction(actual) : "-"}
                      </TableCell>
                    )}
                    {hasActual && (
                      <TableCell
                        className={cn(
                          "font-mono",
                          diff !== null && diff > 0 ? "text-amber-500" : "text-chart-1"
                        )}
                      >
                        {diff !== null ? (diff > 0 ? "+" : "") + formatPrediction(diff) : "-"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
        {result.predictions.length > displayCount && (
          <div className="p-2 text-center text-xs text-muted-foreground border-t">
            Showing {displayCount} of {result.predictions.length} predictions
          </div>
        )}
      </Card>
    </div>
  );
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
  const [inputMode, setInputMode] = useState<InputMode>("paste");
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
      // Parse pasted/uploaded data
      const spectra = parseCSV(pasteData);
      if (spectra.length === 0) {
        toast.error("No valid spectral data found");
        return;
      }
      batchPredictMutation.mutate(spectra);
    }
  };

  const handleExport = () => {
    if (!result) return;

    const hasActual = result.actual_values && result.actual_values.length > 0;
    let csv = hasActual ? "Index,Prediction,Actual,Difference\n" : "Index,Prediction\n";

    result.predictions.forEach((pred, idx) => {
      if (hasActual) {
        const actual = result.actual_values![idx];
        const diff = pred - actual;
        csv += `${idx + 1},${pred},${actual},${diff}\n`;
      } else {
        csv += `${idx + 1},${pred}\n`;
      }
    });

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
          // Show results
          <ResultsDisplay result={result} onExport={handleExport} />
        ) : (
          // Input mode
          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="paste" className="text-xs">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                Paste
              </TabsTrigger>
              <TabsTrigger value="upload" className="text-xs">
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="dataset" className="text-xs">
                <Database className="h-4 w-4 mr-1.5" />
                Dataset
              </TabsTrigger>
            </TabsList>

            <div className="mt-4 min-h-[250px]">
              <TabsContent value="paste" className="m-0">
                <PasteInput value={pasteData} onChange={setPasteData} />
              </TabsContent>

              <TabsContent value="upload" className="m-0">
                <FileUpload onFileLoad={setPasteData} />
              </TabsContent>

              <TabsContent value="dataset" className="m-0">
                <DatasetSelector
                  selectedDataset={selectedDataset}
                  onSelect={setSelectedDataset}
                  selectedPartition={selectedPartition}
                  onPartitionChange={setSelectedPartition}
                />
              </TabsContent>
            </div>
          </Tabs>
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
