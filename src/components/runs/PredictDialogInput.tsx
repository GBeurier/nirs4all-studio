import { useCallback, useState, type DragEvent } from "react";
import { CheckCircle2, Database, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import { cn } from "@/lib/utils";

import type { PredictInputMode } from "./PredictDialogData";

interface PredictDialogInputProps {
  inputMode: PredictInputMode;
  onInputModeChange: (mode: PredictInputMode) => void;
  pasteData: string;
  onPasteDataChange: (value: string) => void;
  selectedDataset: string;
  onDatasetSelect: (id: string) => void;
  selectedPartition: string;
  onPartitionChange: (partition: string) => void;
}

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
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[200px] font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        One spectrum per line. Values separated by comma, semicolon, or tab.
      </p>
    </div>
  );
}

function FileUpload({ onFileLoad }: { onFileLoad: (data: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(csv|txt|tsv)$/i)) {
        toast.error("Please upload a CSV, TXT, or TSV file");
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileName(file.name);
        onFileLoad(text);
      };
      reader.readAsText(file);
    },
    [onFileLoad]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
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
        onDragOver={(event) => {
          event.preventDefault();
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
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFile(file);
            }
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
  const { data: datasetsData, isLoading } = useDatasetsQuery();

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
              datasetsData.datasets.map((dataset) => (
                <SelectItem key={dataset.id} value={dataset.id}>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>{dataset.name}</span>
                    {dataset.num_samples && (
                      <Badge variant="secondary" className="text-xs">
                        {dataset.num_samples} samples
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

export function PredictDialogInput({
  inputMode,
  onInputModeChange,
  pasteData,
  onPasteDataChange,
  selectedDataset,
  onDatasetSelect,
  selectedPartition,
  onPartitionChange,
}: PredictDialogInputProps) {
  return (
    <Tabs
      value={inputMode}
      onValueChange={(value) => onInputModeChange(value as PredictInputMode)}
    >
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
          <PasteInput value={pasteData} onChange={onPasteDataChange} />
        </TabsContent>

        <TabsContent value="upload" className="m-0">
          <FileUpload onFileLoad={onPasteDataChange} />
        </TabsContent>

        <TabsContent value="dataset" className="m-0">
          <DatasetSelector
            selectedDataset={selectedDataset}
            onSelect={onDatasetSelect}
            selectedPartition={selectedPartition}
            onPartitionChange={onPartitionChange}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
