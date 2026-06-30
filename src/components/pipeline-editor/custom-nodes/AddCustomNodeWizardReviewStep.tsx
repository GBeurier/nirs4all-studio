import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { NodeDefinition } from '@/data/nodes/types';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';

interface AddCustomNodeWizardReviewStepProps {
  node: NodeDefinition;
  validationResult?: CustomNodeValidationResult | null;
}

export function AddCustomNodeWizardReviewStep({
  node,
  validationResult,
}: AddCustomNodeWizardReviewStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Review Your Custom Node</h3>
        <p className="text-sm text-muted-foreground">
          Confirm the details before creating your custom operator.
        </p>
      </div>

      {validationResult && !validationResult.valid && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertCircle className="h-4 w-4" />
            Validation Errors
          </div>
          <ul className="text-sm text-destructive list-disc list-inside">
            {validationResult.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {validationResult?.warnings && validationResult.warnings.length > 0 && (
        <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 space-y-2">
          <div className="flex items-center gap-2 text-orange-500 font-medium">
            <AlertCircle className="h-4 w-4" />
            Warnings
          </div>
          <ul className="text-sm text-orange-600 list-disc list-inside">
            {validationResult.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Name</span>
            <p className="font-medium">{node.name}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Type</span>
            <p className="font-medium capitalize">{node.type}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">ID</span>
            <p className="font-mono text-sm">{node.id}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Category</span>
            <p className="font-medium">{node.category || 'Custom'}</p>
          </div>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Description</span>
          <p className="text-sm">{node.description || '\u2014'}</p>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Class Path</span>
          <p className="font-mono text-sm">{node.classPath || '(not specified)'}</p>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Parameters ({node.parameters.length})</span>
          {node.parameters.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {node.parameters.map((param) => (
                <Badge key={param.name} variant="secondary" className="font-mono text-xs">
                  {param.name}: {param.type}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No parameters</p>
          )}
        </div>
      </div>
    </div>
  );
}
