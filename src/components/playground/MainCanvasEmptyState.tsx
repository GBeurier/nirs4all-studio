import { memo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const MainCanvasEmptyState = memo(function MainCanvasEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-lg px-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-6 shadow-lg">
          <FlaskConical className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {t('playground.canvas.empty.title')}
        </h2>
        <p className="text-muted-foreground mb-6 text-base">
          {t('playground.canvas.empty.description')}
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-card rounded-lg border p-4 text-left">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">1</span>
              {t('playground.canvas.empty.loadData')}
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>{t('playground.canvas.empty.uploadCsv')}</li>
              <li>{t('playground.canvas.empty.fromWorkspace')}</li>
              <li>{t('playground.canvas.empty.useDemo')}</li>
            </ul>
          </div>
          <div className="bg-card rounded-lg border p-4 text-left">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">2</span>
              {t('playground.canvas.empty.addOperators')}
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>{t('playground.canvas.empty.preprocessing')}</li>
              <li>{t('playground.canvas.empty.splitters')}</li>
              <li>{t('playground.canvas.empty.combine')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
});
