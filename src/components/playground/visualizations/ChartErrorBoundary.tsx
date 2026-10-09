/**
 * ChartErrorBoundary - Error boundary for visualization charts
 *
 * Prevents chart rendering errors from crashing the entire playground.
 * Displays a user-friendly fallback with retry option.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import i18n from '@/lib/i18n';

interface ChartErrorBoundaryProps {
  /** Chart type for display purposes */
  chartType?: string;
  /** Children to render */
  children: ReactNode;
  /** Optional fallback component */
  fallback?: ReactNode;
  /** Optional callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Chart rendering error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
          <AlertTriangle className="w-8 h-8 text-orange-500 mb-3" />
          <p className="text-sm font-medium mb-1">
            {this.props.chartType
              ? i18n.t('playground.charts.common.renderFailedType', { chartType: this.props.chartType })
              : i18n.t('playground.charts.common.renderFailed')}
          </p>
          <p className="text-xs text-muted-foreground mb-3 text-center max-w-xs">
            {this.state.error?.message || i18n.t('playground.charts.common.unexpectedError')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            className="gap-2"
          >
            <RefreshCw className="w-3 h-3" />
            {i18n.t('common.retry')}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChartErrorBoundary;
