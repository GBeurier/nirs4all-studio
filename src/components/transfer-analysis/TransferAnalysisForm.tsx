import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Database, Settings2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { listDatasets } from '@/api/client';
import { getPreprocessingOptions, getTransferPresets } from '@/api/transfer';
import type { PreprocessingConfig, PreprocessingOptionInfo, TransferPresetInfo } from '@/types/transfer';
import type { Dataset } from '@/types/datasets';

interface TransferAnalysisFormProps {
  selectedDatasets: string[];
  onDatasetsChange: (datasets: string[]) => void;
  preprocessingConfig: PreprocessingConfig;
  onPreprocessingChange: (config: PreprocessingConfig) => void;
  nComponents: number;
  onNComponentsChange: (n: number) => void;
  knn: number;
  onKnnChange: (k: number) => void;
}

export function TransferAnalysisForm({
  selectedDatasets,
  onDatasetsChange,
  preprocessingConfig,
  onPreprocessingChange,
  nComponents,
  onNComponentsChange,
  knn,
  onKnnChange,
}: TransferAnalysisFormProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [presets, setPresets] = useState<TransferPresetInfo[]>([]);
  const [preprocessingOptions, setPreprocessingOptions] = useState<PreprocessingOptionInfo[]>([]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load datasets and options
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [datasetsRes, presetsRes, optionsRes] = await Promise.all([
          listDatasets(),
          getTransferPresets(),
          getPreprocessingOptions(),
        ]);
        setDatasets(datasetsRes.datasets || []);
        setPresets(presetsRes);
        setPreprocessingOptions(optionsRes);
      } catch (error) {
        console.error('Failed to load form data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleDatasetToggle = (datasetId: string) => {
    if (selectedDatasets.includes(datasetId)) {
      onDatasetsChange(selectedDatasets.filter((id) => id !== datasetId));
    } else {
      onDatasetsChange([...selectedDatasets, datasetId]);
    }
  };

  const handlePresetChange = (preset: string) => {
    onPreprocessingChange({
      mode: 'preset',
      preset: preset as PreprocessingConfig['preset'],
    });
  };

  const handleModeChange = (mode: PreprocessingConfig['mode']) => {
    if (mode === 'preset') {
      onPreprocessingChange({
        mode: 'preset',
        preset: 'balanced',
      });
    } else {
      onPreprocessingChange({
        mode: 'manual',
        manual_steps: ['SNV', 'MSC'],
      });
    }
  };

  const handleManualStepToggle = (stepName: string) => {
    const currentSteps = preprocessingConfig.manual_steps || [];
    if (currentSteps.includes(stepName)) {
      onPreprocessingChange({
        ...preprocessingConfig,
        manual_steps: currentSteps.filter((s) => s !== stepName),
      });
    } else {
      onPreprocessingChange({
        ...preprocessingConfig,
        manual_steps: [...currentSteps, stepName],
      });
    }
  };

  // Group preprocessing options by category
  const optionsByCategory = preprocessingOptions.reduce(
    (acc, opt) => {
      if (!acc[opt.category]) {
        acc[opt.category] = [];
      }
      acc[opt.category].push(opt);
      return acc;
    },
    {} as Record<string, PreprocessingOptionInfo[]>
  );

  return (
    <div className="space-y-4">
      {/* Dataset Selection */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          Datasets
        </Label>
        <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading datasets...</p>
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No datasets available</p>
          ) : (
            datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex items-center space-x-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                onClick={() => handleDatasetToggle(dataset.id)}
              >
                <Checkbox
                  id={dataset.id}
                  checked={selectedDatasets.includes(dataset.id)}
                  onCheckedChange={() => handleDatasetToggle(dataset.id)}
                />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={dataset.id}
                    className="text-sm font-medium cursor-pointer truncate block"
                  >
                    {dataset.name}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {dataset.num_samples ?? '?'} samples, {dataset.num_features ?? '?'} features
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        {selectedDatasets.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedDatasets.map((id) => (
              <Badge key={id} variant="secondary" className="text-xs">
                {datasets.find((d) => d.id === id)?.name || id}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Preprocessing Configuration */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Preprocessing
        </Label>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={preprocessingConfig.mode === 'preset' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => handleModeChange('preset')}
          >
            Preset
          </Button>
          <Button
            variant={preprocessingConfig.mode === 'manual' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => handleModeChange('manual')}
          >
            Manual
          </Button>
        </div>

        {/* Preset Mode */}
        {preprocessingConfig.mode === 'preset' && (
          <Select value={preprocessingConfig.preset} onValueChange={handlePresetChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select preset" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.name} value={preset.name}>
                  <div>
                    <span className="font-medium capitalize">{preset.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{preset.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Manual Mode */}
        {preprocessingConfig.mode === 'manual' && (
          <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
            {Object.entries(optionsByCategory).map(([category, options]) => (
              <div key={category} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{category}</p>
                {options.map((opt) => (
                  <div
                    key={opt.name}
                    className="flex items-center space-x-2 p-1 rounded hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleManualStepToggle(opt.name)}
                  >
                    <Checkbox
                      id={opt.name}
                      checked={preprocessingConfig.manual_steps?.includes(opt.name) || false}
                      onCheckedChange={() => handleManualStepToggle(opt.name)}
                    />
                    <label htmlFor={opt.name} className="text-sm cursor-pointer flex-1">
                      {opt.display_name}
                    </label>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced Options */}
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            Advanced Options
            {isAdvancedOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label htmlFor="nComponents" className="text-xs">
              PCA Components
            </Label>
            <Input
              id="nComponents"
              type="number"
              min={2}
              max={50}
              value={nComponents}
              onChange={(e) => onNComponentsChange(parseInt(e.target.value) || 10)}
              className="h-8"
            />
            <p className="text-xs text-muted-foreground">
              Number of principal components for analysis (2-50)
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="knn" className="text-xs">
              KNN Neighbors
            </Label>
            <Input
              id="knn"
              type="number"
              min={2}
              max={50}
              value={knn}
              onChange={(e) => onKnnChange(parseInt(e.target.value) || 10)}
              className="h-8"
            />
            <p className="text-xs text-muted-foreground">
              Neighbors for trustworthiness metric (2-50)
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
