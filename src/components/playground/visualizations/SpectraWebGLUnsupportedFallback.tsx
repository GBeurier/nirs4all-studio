import { useTranslation } from 'react-i18next';

export function SpectraWebGLUnsupportedFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center h-full text-center p-4">
      <div>
        <div className="text-muted-foreground mb-2">{t('playground.charts.common.webglUnsupported')}</div>
        <div className="text-xs text-muted-foreground">{t('playground.charts.common.webglUnsupportedHint')}</div>
      </div>
    </div>
  );
}
