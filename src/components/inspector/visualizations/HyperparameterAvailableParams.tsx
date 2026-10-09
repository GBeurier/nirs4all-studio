import { useTranslation } from 'react-i18next';
import { getHyperparameterAvailableParamTags } from '@/lib/inspector/hyperparameterSensitivityPresentation';

interface HyperparameterAvailableParamsProps {
  params: string[] | undefined;
}

export function HyperparameterAvailableParams({ params }: HyperparameterAvailableParamsProps) {
  const { t } = useTranslation();
  const { visibleParams, overflowCount } = getHyperparameterAvailableParamTags(params);

  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      {visibleParams.map(param => (
        <span key={param} className="rounded-full border border-border/60 bg-background px-2 py-0.5">
          {param}
        </span>
      ))}
      {overflowCount > 0 && (
        <span className="rounded-full border border-border/60 bg-background px-2 py-0.5">
          {t('inspector.charts.hyperparameter.moreParams', { count: overflowCount })}
        </span>
      )}
    </div>
  );
}
