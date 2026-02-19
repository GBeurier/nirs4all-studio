import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Database, FlaskConical } from 'lucide-react';
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
import type { AvailableModelsResponse, AvailableChain, DatasetChains } from '@/types/shap';

interface ModelSelectorProps {
  selectedChainId: string | null;
  onChainSelect: (chainId: string | null, datasetName: string | null) => void;
}

export function ModelSelector({ selectedChainId, onChainSelect }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<AvailableModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAvailableModels()
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load models'))
      .finally(() => setLoading(false));
  }, []);

  // Flatten all chains for the select with dataset grouping
  const allChains = useMemo(() => {
    if (!data) return [];
    return data.datasets;
  }, [data]);

  // Short model class name (remove package prefix)
  const shortModelClass = (cls: string) => {
    const parts = cls.split('.');
    return parts[parts.length - 1];
  };

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

  const totalChains = allChains.reduce((n, d) => n + d.chains.length, 0);
  if (totalChains === 0 && (!data?.bundles || data.bundles.length === 0)) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        {t('shap.noModels', 'No trained models found. Run an experiment first.')}
      </div>
    );
  }

  const handleSelect = (value: string) => {
    if (!value) {
      onChainSelect(null, null);
      return;
    }
    // Find chain to get dataset_name
    for (const ds of allChains) {
      const chain = ds.chains.find((c) => c.chain_id === value);
      if (chain) {
        onChainSelect(chain.chain_id, chain.dataset_name);
        return;
      }
    }
    // Check bundles
    if (data?.bundles) {
      const bundle = data.bundles.find((b) => b.bundle_path === value);
      if (bundle) {
        onChainSelect(value, bundle.dataset_name || null);
        return;
      }
    }
    onChainSelect(value, null);
  };

  const formatScore = (score: number | null) => {
    if (score === null || score === undefined) return null;
    return score.toFixed(4);
  };

  return (
    <Select value={selectedChainId || ''} onValueChange={handleSelect}>
      <SelectTrigger>
        <SelectValue placeholder={t('shap.selectModel', 'Select a trained model...')} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {allChains.map((ds: DatasetChains) => (
          <SelectGroup key={ds.dataset_name}>
            <SelectLabel className="flex items-center gap-2">
              <Database className="h-3 w-3" />
              {ds.dataset_name}
              {ds.metric && (
                <span className="text-xs text-muted-foreground">({ds.metric})</span>
              )}
            </SelectLabel>
            {ds.chains.map((chain: AvailableChain) => (
              <SelectItem key={chain.chain_id} value={chain.chain_id}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate max-w-[140px]">
                    {chain.preprocessings ? `${chain.preprocessings} → ` : ''}
                    {shortModelClass(chain.model_class)}
                  </span>
                  {chain.has_refit && (
                    <Badge variant="default" className="text-[10px] px-1 py-0 shrink-0">
                      refit
                    </Badge>
                  )}
                  {!chain.has_refit && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                      CV
                    </Badge>
                  )}
                  {formatScore(chain.cv_val_score) && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatScore(chain.cv_val_score)}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {data?.bundles && data.bundles.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-2">
              <FlaskConical className="h-3 w-3" />
              {t('shap.bundles', 'Exported Bundles')}
            </SelectLabel>
            {data.bundles.map((bundle) => (
              <SelectItem key={bundle.bundle_path} value={bundle.bundle_path}>
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[180px]">{bundle.display_name}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    .n4a
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
