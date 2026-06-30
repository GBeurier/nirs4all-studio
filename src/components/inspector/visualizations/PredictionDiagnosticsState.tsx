import { Loader2 } from 'lucide-react';
import { getPredictionDiagnosticsEmptyMessage } from '@/lib/inspector/predictionDiagnosticsPresentation';

interface PredictionDiagnosticsLoadingStateProps {
  message: string;
}

export function PredictionDiagnosticsLoadingState({
  message,
}: PredictionDiagnosticsLoadingStateProps) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function PredictionDiagnosticsEmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {getPredictionDiagnosticsEmptyMessage()}
    </div>
  );
}
