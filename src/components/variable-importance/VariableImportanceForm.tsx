import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ModelSelector } from './ModelSelector';
import { listDatasets } from '@/api/client';
import type {
  ModelSource,
  ExplainerType,
  BinAggregation,
  Partition,
} from '@/types/shap';

interface Dataset {
  id: string;
  name: string;
}

interface VariableImportanceFormProps {
  modelSource: ModelSource;
  onModelSourceChange: (source: ModelSource) => void;
  modelId: string | null;
  onModelIdChange: (id: string | null) => void;
  datasetId: string | null;
  onDatasetIdChange: (id: string | null) => void;
  partition: Partition;
  onPartitionChange: (partition: Partition) => void;
  explainerType: ExplainerType;
  onExplainerTypeChange: (type: ExplainerType) => void;
  nSamples: number | null;
  onNSamplesChange: (n: number | null) => void;
  binSize: number;
  onBinSizeChange: (size: number) => void;
  binStride: number;
  onBinStrideChange: (stride: number) => void;
  binAggregation: BinAggregation;
  onBinAggregationChange: (agg: BinAggregation) => void;
}

export function VariableImportanceForm({
  modelSource,
  onModelSourceChange,
  modelId,
  onModelIdChange,
  datasetId,
  onDatasetIdChange,
  partition,
  onPartitionChange,
  explainerType,
  onExplainerTypeChange,
  nSamples,
  onNSamplesChange,
  binSize,
  onBinSizeChange,
  binStride,
  onBinStrideChange,
  binAggregation,
  onBinAggregationChange,
}: VariableImportanceFormProps) {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Load datasets
  useEffect(() => {
    listDatasets()
      .then((response) => {
        setDatasets(response.datasets.map((d) => ({ id: d.id, name: d.name })));
      })
      .catch((err) => {
        console.error('Failed to load datasets:', err);
      });
  }, []);

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          {t('shap.form.modelSource', 'Model Source')}
        </Label>
        <Select
          value={modelSource}
          onValueChange={(value) => {
            onModelSourceChange(value as ModelSource);
            onModelIdChange(null);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="run">
              {t('shap.form.fromRun', 'From Training Run')}
            </SelectItem>
            <SelectItem value="bundle">
              {t('shap.form.fromBundle', 'From Exported Bundle')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Model Selector */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          {t('shap.form.model', 'Model')}
        </Label>
        <ModelSelector
          source={modelSource}
          selectedId={modelId}
          onSelect={onModelIdChange}
        />
      </div>

      {/* Dataset Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          {t('shap.form.dataset', 'Dataset to Explain')}
        </Label>
        <Select
          value={datasetId || ''}
          onValueChange={(value) => onDatasetIdChange(value || null)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('shap.form.selectDataset', 'Select dataset...')} />
          </SelectTrigger>
          <SelectContent>
            {datasets.map((dataset) => (
              <SelectItem key={dataset.id} value={dataset.id}>
                {dataset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Partition Selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label className="text-sm font-medium">
            {t('shap.form.partition', 'Partition')}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-xs">
                  {t(
                    'shap.form.partitionHelp',
                    'Use the test partition for unbiased importance estimates'
                  )}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select value={partition} onValueChange={(v) => onPartitionChange(v as Partition)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="train">Train</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Explainer Type */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label className="text-sm font-medium">
            {t('shap.form.explainerType', 'Explainer Type')}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-xs">
                  {t(
                    'shap.form.explainerHelp',
                    'Auto will select the best explainer based on your model type'
                  )}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={explainerType}
          onValueChange={(v) => onExplainerTypeChange(v as ExplainerType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="tree">Tree (RF, GBR, XGBoost)</SelectItem>
            <SelectItem value="linear">Linear (PLS, Ridge)</SelectItem>
            <SelectItem value="kernel">Kernel (any model)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Advanced Options */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            {t('shap.form.advancedOptions', 'Advanced Options')}
            {advancedOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          {/* Sample Limit */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {t('shap.form.sampleLimit', 'Sample Limit')}
              </Label>
              <span className="text-xs text-muted-foreground">
                {nSamples === null ? 'All' : nSamples}
              </span>
            </div>
            <Slider
              value={[nSamples ?? 0]}
              onValueChange={([value]) => onNSamplesChange(value === 0 ? null : value)}
              min={0}
              max={500}
              step={50}
            />
            <p className="text-xs text-muted-foreground">
              {t('shap.form.sampleLimitHelp', '0 = use all samples (slower)')}
            </p>
          </div>

          {/* Bin Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {t('shap.form.binSize', 'Bin Size')}
              </Label>
              <span className="text-xs text-muted-foreground">{binSize}</span>
            </div>
            <Slider
              value={[binSize]}
              onValueChange={([value]) => onBinSizeChange(value)}
              min={5}
              max={50}
              step={5}
            />
          </div>

          {/* Bin Stride */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {t('shap.form.binStride', 'Bin Stride')}
              </Label>
              <span className="text-xs text-muted-foreground">{binStride}</span>
            </div>
            <Slider
              value={[binStride]}
              onValueChange={([value]) => onBinStrideChange(value)}
              min={1}
              max={binSize}
              step={1}
            />
          </div>

          {/* Aggregation Method */}
          <div className="space-y-2">
            <Label className="text-sm">
              {t('shap.form.aggregation', 'Aggregation')}
            </Label>
            <Select
              value={binAggregation}
              onValueChange={(v) => onBinAggregationChange(v as BinAggregation)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sum">Sum</SelectItem>
                <SelectItem value="sum_abs">Sum (absolute)</SelectItem>
                <SelectItem value="mean">Mean</SelectItem>
                <SelectItem value="mean_abs">Mean (absolute)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
