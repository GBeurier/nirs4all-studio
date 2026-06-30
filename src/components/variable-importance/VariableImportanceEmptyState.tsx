import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export function VariableImportanceEmptyState() {
  const { t } = useTranslation();

  return (
    <Card className="h-full min-h-[400px] flex items-center justify-center">
      <CardContent className="text-center py-12">
        <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-muted mb-4">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">
          {t('shap.noResults', 'No Results Yet')}
        </h3>
        <p className="text-muted-foreground max-w-md mx-auto mb-4">
          {t(
            'shap.instructions',
            'Select a trained model, then click "Compute Explanations" to analyze which wavelengths are most important for predictions.',
          )}
        </p>
        <div className="flex flex-wrap gap-2 justify-center text-xs text-muted-foreground">
          <span className="px-2 py-1 bg-muted rounded">
            {t('shap.features.spectral', 'Spectral importance')}
          </span>
          <span className="px-2 py-1 bg-muted rounded">
            {t('shap.features.beeswarm', 'SHAP distribution')}
          </span>
          <span className="px-2 py-1 bg-muted rounded">
            {t('shap.features.waterfall', 'Sample breakdown')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
