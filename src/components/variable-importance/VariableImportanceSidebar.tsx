import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, PlayCircle, TrendingUp } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { VariableImportanceForm } from './VariableImportanceForm';
import type { ExplainerType, Partition } from '@/types/shap';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';

interface VariableImportanceSidebarProps {
  chainId: string | null;
  onChainSelect: (chainId: string | null, datasetName: string | null, modelRef?: ShapExplicitModelRef | null) => void;
  partition: Partition;
  onPartitionChange: (partition: Partition) => void;
  explainerType: ExplainerType;
  onExplainerTypeChange: (type: ExplainerType) => void;
  error: string | null;
  isRunning: boolean;
  canRun: boolean;
  onRunAnalysis: () => void;
  jobId: string | null;
  progress: number;
  progressMessage: string;
}

export function VariableImportanceSidebar({
  chainId,
  onChainSelect,
  partition,
  onPartitionChange,
  explainerType,
  onExplainerTypeChange,
  error,
  isRunning,
  canRun,
  onRunAnalysis,
  jobId,
  progress,
  progressMessage,
}: VariableImportanceSidebarProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-lg">
            {t('shap.title', 'SHAP Analysis')}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <VariableImportanceForm
          chainId={chainId}
          onChainSelect={onChainSelect}
          partition={partition}
          onPartitionChange={onPartitionChange}
          explainerType={explainerType}
          onExplainerTypeChange={onExplainerTypeChange}
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          className="w-full"
          onClick={onRunAnalysis}
          disabled={!canRun}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('shap.computing', 'Computing...')}
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" />
              {t('shap.compute', 'Compute Explanations')}
            </>
          )}
        </Button>

        {isRunning && jobId && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {progressMessage || 'Starting...'}
            </p>
          </div>
        )}

        {!chainId && (
          <p className="text-xs text-muted-foreground text-center">
            {t('shap.selectModel', 'Select a model to explain')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
