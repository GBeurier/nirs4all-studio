import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info, Zap } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { ShapSubsetsPanel } from './ShapSubsetsPanel';
import { useDatasetsQuery } from '@/hooks/useDatasetQueries';
import {
  buildShapPredictHref,
  isNonAdditiveExplainer,
  isShapPlsModel,
  normalizeShapOptions,
  normalizeShapPartition,
  SHAP_BASELINE_OPTIONS,
  SHAP_ENGINE_OPTIONS,
  SHAP_LIMITS,
  SHAP_PARTITION_OPTIONS,
  shapExplainerOptions,
  usesShapBaseline,
  usesShapPermutations,
  type ShapAnalysisOptions,
} from '@/lib/shapVariableImportanceFormData';
import type { Partition } from '@/types/shap';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';

interface VariableImportanceFormProps {
  chainId: string | null;
  datasetId: string | null;
  needsDatasetSelection: boolean;
  onDatasetSelect: (datasetId: string) => void;
  onChainSelect: (chainId: string | null, datasetName: string | null, modelRef?: ShapExplicitModelRef | null, datasetId?: string | null) => void;
  partition: Partition;
  onPartitionChange: (partition: Partition) => void;
  options: ShapAnalysisOptions;
  pythonShapAvailable: boolean;
  onOptionsChange: (options: ShapAnalysisOptions) => void;
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label className="text-sm font-medium">{label}</Label>
      {help && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-xs">{help}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function OptionSelect<TValue extends string>({ label, help, value, options, onChange, disabled }: {
  label: string;
  help?: string;
  value: TValue;
  options: { value: TValue; labelKey: string }[];
  onChange: (value: string) => void;
  disabled?: (value: TValue) => boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <FieldLabel label={label} help={help} />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={disabled?.(option.value)}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Integer within backend bounds, committed on blur or Enter. An empty field
 * commits null when `emptyLabel` allows it (engine default or all rows).
 */
function IntegerField({ label, help, value, limits, emptyLabel, onCommit }: {
  label: string;
  help?: string;
  value: number | null;
  limits: { min: number; max: number };
  emptyLabel?: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '' && emptyLabel) return onCommit(null);
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed)) return setText(value === null ? '' : String(value));
    const bounded = Math.min(limits.max, Math.max(limits.min, Math.round(parsed)));
    setText(String(bounded));
    onCommit(bounded);
  };
  return (
    <div className="space-y-2">
      <FieldLabel label={label} help={help} />
      <Input
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        step={1}
        value={text}
        placeholder={emptyLabel}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      />
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function ShapDatasetPicker({ datasetId, onSelect }: {
  datasetId: string | null;
  onSelect: (datasetId: string) => void;
}) {
  const { t } = useTranslation();
  const { data, isPending, error } = useDatasetsQuery();
  const datasets = data?.datasets.filter((dataset) => dataset.status !== 'missing' && dataset.status !== 'error') ?? [];
  return (
    <div className="space-y-2">
      <Label htmlFor="shap-analysis-dataset">{t('results.variableImportance.model.analysisDataset')}</Label>
      <select
        id="shap-analysis-dataset"
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        value={datasetId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        disabled={isPending || datasets.length === 0}
      >
        <option value="">{t('results.variableImportance.model.chooseDataset')}</option>
        {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
      </select>
      {error && <p role="alert" className="text-xs text-destructive">{t('results.variableImportance.model.loadDatasetsFailed')}</p>}
      {!isPending && !error && datasets.length === 0 && (
        <Link to="/datasets" className="text-xs underline">{t('results.variableImportance.model.linkDataset')}</Link>
      )}
    </div>
  );
}

export function VariableImportanceForm({
  chainId,
  datasetId,
  needsDatasetSelection,
  onDatasetSelect,
  onChainSelect,
  partition,
  onPartitionChange,
  options,
  pythonShapAvailable,
  onOptionsChange,
}: VariableImportanceFormProps) {
  const { t } = useTranslation();
  const [modelClass, setModelClass] = useState<string | null>(null);
  const isPls = isShapPlsModel(modelClass);
  const update = (patch: Partial<ShapAnalysisOptions>) => onOptionsChange(normalizeShapOptions({ ...options, ...patch }));
  const native = options.engine === 'native';

  useEffect(() => {
    // A restored tree selection cannot apply when the selected model is PLS.
    if (isPls && options.explainerType === 'tree') onOptionsChange({ ...options, explainerType: 'auto' });
  }, [isPls, options, onOptionsChange]);

  return (
    <div className="space-y-4">
      {/* Model Selection (chain-based, grouped by dataset) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            {t('shap.form.model')}
          </Label>
          {chainId && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-emerald-600" asChild>
              <Link to={buildShapPredictHref(chainId)}>
                <Zap className="h-3 w-3" /> {t('results.variableImportance.predict')}
              </Link>
            </Button>
          )}
        </div>
        <ModelSelector
          selectedChainId={chainId}
          onChainSelect={onChainSelect}
          onModelClassChange={setModelClass}
        />
      </div>
      {needsDatasetSelection && <ShapDatasetPicker datasetId={datasetId} onSelect={onDatasetSelect} />}

      {options.subsets.enabled ? (
        <div className="space-y-1">
          <FieldLabel label={t('shap.form.partition')} />
          <p className="text-xs text-muted-foreground">{t('shap.subsets.partitionReplaced')}</p>
        </div>
      ) : (
        <OptionSelect
          label={t('shap.form.partition')}
          help={t('shap.form.partitionHelp')}
          value={partition}
          options={SHAP_PARTITION_OPTIONS}
          onChange={(value) => onPartitionChange(normalizeShapPartition(value))}
        />
      )}

      <OptionSelect
        label={t('shap.form.engine')}
        help={t('shap.form.engineHelp')}
        value={options.engine}
        options={SHAP_ENGINE_OPTIONS}
        onChange={(value) => update({ engine: value as ShapAnalysisOptions['engine'] })}
        disabled={(value) => value === 'python' && !pythonShapAvailable}
      />
      {!pythonShapAvailable && (
        <p className="text-xs text-muted-foreground">
          <Link to="/settings?tab=python" className="underline">{t('shap.form.installPython')}</Link>
        </p>
      )}

      <OptionSelect
        label={t('shap.form.explainerType')}
        help={t(native ? 'shap.form.nativeExplainerHelp' : 'shap.form.explainerHelp')}
        value={options.explainerType}
        options={shapExplainerOptions(options.engine)}
        onChange={(value) => update({ explainerType: value as ShapAnalysisOptions['explainerType'] })}
        disabled={(value) => isPls && value === 'tree'}
      />

      <Grid>
        <IntegerField
          label={t('shap.form.samplesExplained')}
          help={t('shap.form.samplesExplainedHelp')}
          value={options.nSamples}
          limits={SHAP_LIMITS.nSamples}
          emptyLabel={t('shap.form.all')}
          onCommit={(nSamples) => update({ nSamples })}
        />
        <IntegerField
          label={t('shap.form.backgroundSize')}
          help={t('shap.form.backgroundSizeHelp')}
          value={options.nBackground}
          limits={SHAP_LIMITS.nBackground}
          onCommit={(nBackground) => update({ nBackground: nBackground ?? options.nBackground })}
        />
      </Grid>

      {native && (
        <>
          {usesShapBaseline(options) && (
            <OptionSelect
              label={t('shap.form.baseline')}
              help={t('shap.form.baselineHelp')}
              value={options.baseline}
              options={SHAP_BASELINE_OPTIONS}
              onChange={(value) => update({ baseline: value as ShapAnalysisOptions['baseline'] })}
            />
          )}
          <Grid>
            <IntegerField
              label={t('shap.form.groupWidth')}
              help={t('shap.form.groupWidthHelp')}
              value={options.groupWidth}
              limits={SHAP_LIMITS.groupWidth}
              emptyLabel={t('shap.form.auto')}
              onCommit={(groupWidth) => update({ groupWidth })}
            />
            {usesShapPermutations(options) ? (
              <IntegerField
                label={t('shap.form.permutations')}
                help={t('shap.form.permutationsHelp')}
                value={options.nPermutations}
                limits={SHAP_LIMITS.nPermutations}
                emptyLabel={t('shap.form.auto')}
                onCommit={(nPermutations) => update({ nPermutations })}
              />
            ) : <div />}
            <IntegerField
              label={t('shap.form.seed')}
              help={t('shap.form.seedHelp')}
              value={options.seed}
              limits={SHAP_LIMITS.seed}
              onCommit={(seed) => update({ seed: seed ?? options.seed })}
            />
          </Grid>
        </>
      )}

      <ShapSubsetsPanel datasetId={datasetId} subsets={options.subsets} onChange={(subsets) => update({ subsets })} />

      <p className="text-xs text-muted-foreground">
        {isPls && `${t('shap.form.plsTreeUnavailable')} `}
        {native ? t('shap.form.nativeNote') : t('shap.form.pythonNote')}
        {native && isNonAdditiveExplainer(options.explainerType) && ` ${t('shap.form.nonAdditiveNote')}`}
      </p>
    </div>
  );
}
