import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info, Zap } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ModelSelector } from './ModelSelector';
import {
  buildShapPredictHref,
  normalizeShapExplainerType,
  normalizeShapPartition,
  SHAP_EXPLAINER_OPTIONS,
  SHAP_PARTITION_OPTIONS,
} from '@/lib/shapVariableImportanceFormData';
import type {
  ExplainerType,
  Partition,
} from '@/types/shap';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';

interface VariableImportanceFormProps {
  chainId: string | null;
  onChainSelect: (chainId: string | null, datasetName: string | null, modelRef?: ShapExplicitModelRef | null) => void;
  partition: Partition;
  onPartitionChange: (partition: Partition) => void;
  explainerType: ExplainerType;
  onExplainerTypeChange: (type: ExplainerType) => void;
}

export function VariableImportanceForm({
  chainId,
  onChainSelect,
  partition,
  onPartitionChange,
  explainerType,
  onExplainerTypeChange,
}: VariableImportanceFormProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Model Selection (chain-based, grouped by dataset) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            {t('shap.form.model', 'Model')}
          </Label>
          {chainId && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-emerald-600" asChild>
              <Link to={buildShapPredictHref(chainId)}>
                <Zap className="h-3 w-3" /> Predict
              </Link>
            </Button>
          )}
        </div>
        <ModelSelector
          selectedChainId={chainId}
          onChainSelect={onChainSelect}
        />
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
        <Select value={partition} onValueChange={(value) => onPartitionChange(normalizeShapPartition(value))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHAP_PARTITION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
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
          onValueChange={(value) => onExplainerTypeChange(normalizeShapExplainerType(value))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHAP_EXPLAINER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
