import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
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
import type {
  ExplainerType,
  Partition,
} from '@/types/shap';

interface VariableImportanceFormProps {
  chainId: string | null;
  onChainSelect: (chainId: string | null, datasetName: string | null) => void;
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
        <Label className="text-sm font-medium">
          {t('shap.form.model', 'Model')}
        </Label>
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
    </div>
  );
}
