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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getAvailableModels } from '@/api/shap';
import {
  buildShapChainLabel,
  buildShapChainTooltip,
  countShapModelChains,
  filterShapModelBundles,
  filterShapModelDatasets,
  getShapModelClassOptions,
  getShapModelDatasetOptions,
  getVisibleShapChainScore,
  hasVisibleShapModelOptions,
  resolveShapModelSelection,
  SHAP_MODEL_SELECTOR_ALL_VALUE,
} from '@/lib/shapModelSelectorData';
import type { AvailableModelsResponse } from '@/types/shap';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';

interface ModelSelectorProps {
  selectedChainId: string | null;
  onChainSelect: (chainId: string | null, datasetName: string | null, modelRef?: ShapExplicitModelRef | null) => void;
}

export function ModelSelector({ selectedChainId, onChainSelect }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<AvailableModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datasetFilter, setDatasetFilter] = useState<string>(SHAP_MODEL_SELECTOR_ALL_VALUE);
  const [modelFilter, setModelFilter] = useState<string>(SHAP_MODEL_SELECTOR_ALL_VALUE);

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

  // Filter options: datasets that exist + model classes available under the current dataset filter
  const datasetOptions = useMemo(() => getShapModelDatasetOptions(allChains), [allChains]);
  const modelOptions = useMemo(() => {
    return getShapModelClassOptions(allChains, datasetFilter);
  }, [allChains, datasetFilter]);

  // Apply filters + sort chains by score (direction depends on metric)
  const filteredDatasets = useMemo(() => {
    return filterShapModelDatasets(allChains, datasetFilter, modelFilter);
  }, [allChains, datasetFilter, modelFilter]);

  const filteredBundles = useMemo(() => {
    const bundles = data?.bundles ?? [];
    return filterShapModelBundles(bundles, datasetFilter, modelFilter);
  }, [data, datasetFilter, modelFilter]);

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

  const totalChains = countShapModelChains(allChains);
  if (totalChains === 0 && (!data?.bundles || data.bundles.length === 0)) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        {t('shap.noModels', 'No trained models found. Run an experiment first.')}
      </div>
    );
  }

  const handleSelect = (value: string) => {
    const selection = resolveShapModelSelection(value, allChains, data?.bundles ?? []);
    onChainSelect(selection.chainId, selection.datasetName, selection.modelRef);
  };

  const hasVisible = hasVisibleShapModelOptions(filteredDatasets, filteredBundles);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Dataset</Label>
          <Select value={datasetFilter} onValueChange={setDatasetFilter}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SHAP_MODEL_SELECTOR_ALL_VALUE}>All datasets</SelectItem>
              {datasetOptions.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SHAP_MODEL_SELECTOR_ALL_VALUE}>All models</SelectItem>
              {modelOptions.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Select value={selectedChainId || ''} onValueChange={handleSelect}>
        <SelectTrigger>
          <SelectValue placeholder={t('shap.selectModel', 'Select a trained model...')} />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {!hasVisible && (
            <div className="px-2 py-2 text-xs text-muted-foreground text-center">
              No models match these filters
            </div>
          )}
          {filteredDatasets.map((ds) => (
            <SelectGroup key={ds.dataset_name}>
              <SelectLabel className="flex items-center gap-2">
                <Database className="h-3 w-3" />
                {ds.dataset_name}
                {ds.metric && (
                  <span className="text-xs text-muted-foreground">({ds.metric})</span>
                )}
              </SelectLabel>
              {ds.chains.map((chain) => {
                const chainLabel = buildShapChainLabel(chain);
                const chainTooltip = buildShapChainTooltip(chain);
                const visibleScore = getVisibleShapChainScore(chain);

                return (
                  <SelectItem key={chain.chain_id} value={chain.chain_id}>
                    <div className="flex items-center gap-2 min-w-0" title={chainTooltip}>
                      <span className="truncate max-w-[160px]">{chainLabel}</span>
                      <Badge variant="default" className="text-[10px] px-1 py-0 shrink-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30">
                        refit
                      </Badge>
                      {visibleScore && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {visibleScore}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
          {filteredBundles.length > 0 && (
            <SelectGroup>
              <SelectLabel className="flex items-center gap-2">
                <FlaskConical className="h-3 w-3" />
                {t('shap.bundles', 'Exported Bundles')}
              </SelectLabel>
              {filteredBundles.map((bundle) => (
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
    </div>
  );
}
