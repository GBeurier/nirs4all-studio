import { AlertTriangle, Repeat, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type RepetitionsChartEmptyStateKind = 'loading' | 'error' | 'no-repetitions';

export interface RepetitionsChartEmptyStateProps {
  kind: RepetitionsChartEmptyStateKind;
  message?: string;
  error?: string;
  onConfigureRepetitions?: () => void;
}

export function RepetitionsChartEmptyState({
  kind,
  message,
  error,
  onConfigureRepetitions,
}: RepetitionsChartEmptyStateProps) {
  if (kind === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>Loading repetition data...</p>
        </div>
      </div>
    );
  }

  if (kind === 'error') {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500/70 mx-auto mb-2" />
          <p className="text-amber-600">Repetition analysis error</p>
          <p className="text-xs mt-1 max-w-[200px]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <div className="text-center max-w-[250px]">
        <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
        <p className="font-medium mb-1">No repetitions detected</p>
        <p className="text-xs">{message || 'Samples appear to be unique measurements.'}</p>
        {onConfigureRepetitions && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 text-xs"
            onClick={onConfigureRepetitions}
          >
            <Settings2 className="w-3 h-3 mr-1" />
            Configure Detection
          </Button>
        )}
      </div>
    </div>
  );
}
