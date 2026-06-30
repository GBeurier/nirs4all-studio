import { AlertCircle } from 'lucide-react';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';

interface CustomNodeValidationBannersProps {
  hasErrors: boolean | null;
  hasWarnings: boolean | null;
  validationResult: CustomNodeValidationResult | null;
}

export function CustomNodeValidationBanners({
  hasErrors,
  hasWarnings,
  validationResult,
}: CustomNodeValidationBannersProps) {
  return (
    <>
      {hasErrors && validationResult && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              {validationResult.errors.map((error, i) => (
                <p key={i} className="text-xs text-destructive">{error}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasWarnings && validationResult && !hasErrors && (
        <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              {validationResult.warnings.map((warning, i) => (
                <p key={i} className="text-xs text-orange-500">{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
