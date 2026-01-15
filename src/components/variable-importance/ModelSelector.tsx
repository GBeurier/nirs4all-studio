import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, FlaskConical, AlertCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getAvailableModels } from '@/api/shap';
import type { AvailableModel, ModelSource } from '@/types/shap';

interface ModelSelectorProps {
  source: ModelSource;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ModelSelector({ source, selectedId, onSelect }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [models, setModels] = useState<{
    runs: AvailableModel[];
    bundles: AvailableModel[];
  }>({ runs: [], bundles: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    getAvailableModels()
      .then((data) => {
        setModels(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load models');
        setLoading(false);
      });
  }, []);

  const currentModels = source === 'run' ? models.runs : models.bundles;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">{t('shap.loadingModels', 'Loading models...')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (currentModels.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        {source === 'run'
          ? t('shap.noRuns', 'No completed runs with models found')
          : t('shap.noBundles', 'No exported bundles found')}
      </div>
    );
  }

  // Group runs by dataset
  const groupedRuns = currentModels.reduce(
    (acc, model) => {
      const group = model.dataset_name || 'Other';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(model);
      return acc;
    },
    {} as Record<string, AvailableModel[]>
  );

  return (
    <Select value={selectedId || ''} onValueChange={(value) => onSelect(value || null)}>
      <SelectTrigger>
        <SelectValue
          placeholder={
            source === 'run'
              ? t('shap.selectRun', 'Select a training run...')
              : t('shap.selectBundle', 'Select a bundle...')
          }
        />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedRuns).map(([group, groupModels]) => (
          <SelectGroup key={group}>
            <SelectLabel className="flex items-center gap-2">
              {source === 'run' ? (
                <FlaskConical className="h-3 w-3" />
              ) : (
                <Package className="h-3 w-3" />
              )}
              {group}
            </SelectLabel>
            {groupModels.map((model) => (
              <SelectItem key={model.model_id} value={model.model_id}>
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[180px]">{model.display_name}</span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {model.model_type}
                  </Badge>
                  {model.metrics.rmse && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      RMSE: {model.metrics.rmse.toFixed(3)}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
