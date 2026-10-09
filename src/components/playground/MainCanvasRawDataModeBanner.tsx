import { memo } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const MainCanvasRawDataModeBanner = memo(function MainCanvasRawDataModeBanner() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <Info className="w-4 h-4 text-blue-500 shrink-0" />
      <span className="text-xs text-blue-700 dark:text-blue-300">
        <strong>{t('playground.canvas.rawMode.label')}</strong> {t('playground.canvas.rawMode.description')}
      </span>
    </div>
  );
});
