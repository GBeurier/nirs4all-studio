/**
 * ExecutionStatus - Shows processing status and errors
 *
 * Provides visual feedback during pipeline execution.
 */

import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepTrace, StepError } from '@/types/playground';

interface ExecutionStatusProps {
  isProcessing: boolean;
  isFetching: boolean;
  isDebouncing: boolean;
  executionTimeMs?: number;
  trace?: StepTrace[];
  errors?: StepError[];
  className?: string;
}

export function ExecutionStatus({
  isProcessing,
  isFetching,
  isDebouncing,
  executionTimeMs,
  trace = [],
  errors = [],
  className,
}: ExecutionStatusProps) {
  // Determine current state
  const isLoading = isProcessing || isFetching;
  const hasErrors = errors.length > 0;

  if (isDebouncing) {
    return (
      <StatusBadge
        icon={<Clock className="w-3 h-3" />}
        text="Waiting..."
        variant="muted"
        className={className}
      />
    );
  }

  if (isLoading) {
    return (
      <StatusBadge
        icon={<Loader2 className="w-3 h-3 animate-spin" />}
        text="Processing..."
        variant="primary"
        className={className}
      />
    );
  }

  if (hasErrors) {
    return (
      <StatusBadge
        icon={<AlertCircle className="w-3 h-3" />}
        text={`${errors.length} error${errors.length > 1 ? 's' : ''}`}
        variant="destructive"
        className={className}
      />
    );
  }

  if (executionTimeMs !== undefined) {
    return (
      <StatusBadge
        icon={<CheckCircle className="w-3 h-3" />}
        text={`${executionTimeMs.toFixed(0)}ms`}
        variant="success"
        className={className}
      />
    );
  }

  return null;
}

interface StatusBadgeProps {
  icon: React.ReactNode;
  text: string;
  variant: 'primary' | 'muted' | 'success' | 'destructive';
  className?: string;
}

function StatusBadge({ icon, text, variant, className }: StatusBadgeProps) {
  const variantStyles = {
    primary: 'bg-primary/10 text-primary',
    muted: 'bg-muted text-muted-foreground',
    success: 'bg-green-500/10 text-green-600 dark:text-green-400',
    destructive: 'bg-destructive/10 text-destructive',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium',
        variantStyles[variant],
        className
      )}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}

/**
 * ExecutionTrace - Detailed trace of pipeline execution
 */
interface ExecutionTraceProps {
  trace: StepTrace[];
  className?: string;
}

export function ExecutionTrace({ trace, className }: ExecutionTraceProps) {
  if (trace.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <h4 className="text-xs font-medium text-muted-foreground">Execution Trace</h4>
      <div className="space-y-0.5">
        {trace.map((step, i) => (
          <div
            key={step.step_id}
            className={cn(
              'flex items-center gap-2 text-[10px] px-2 py-1 rounded',
              step.success ? 'bg-muted/50' : 'bg-destructive/10'
            )}
          >
            <span className="text-muted-foreground">{i + 1}.</span>
            <span className="font-medium truncate flex-1">{step.name}</span>
            {step.success ? (
              <span className="text-green-600 dark:text-green-400">
                {step.duration_ms.toFixed(1)}ms
              </span>
            ) : (
              <span className="text-destructive truncate max-w-[120px]" title={step.error}>
                {step.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ErrorDisplay - Shows detailed error information
 */
interface ErrorDisplayProps {
  errors: StepError[];
  className?: string;
}

export function ErrorDisplay({ errors, className }: ErrorDisplayProps) {
  if (errors.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <h4 className="text-xs font-medium text-destructive flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        Errors
      </h4>
      <div className="space-y-1">
        {errors.map((err, i) => (
          <div
            key={i}
            className="text-[10px] px-2 py-1.5 bg-destructive/10 rounded text-destructive"
          >
            <span className="font-medium">{err.name}:</span>{' '}
            <span className="opacity-90">{err.error}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ExecutionStatus;
