import { useState, useCallback, useEffect } from 'react';
import { motion } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Loader2, PlayCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TransferAnalysisForm } from '@/components/transfer-analysis/TransferAnalysisForm';
import { ResultsPanel } from '@/components/transfer-analysis/ResultsPanel';
import { computeTransferAnalysis } from '@/api/transfer';
import type {
  PreprocessingConfig,
  TransferAnalysisResponse,
  TransferMetricType,
} from '@/types/transfer';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function TransferAnalysis() {
  const { t } = useTranslation();

  // State
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [preprocessingConfig, setPreprocessingConfig] = useState<PreprocessingConfig>({
    mode: 'preset',
    preset: 'balanced',
  });
  const [nComponents, setNComponents] = useState(10);
  const [knn, setKnn] = useState(10);
  const [results, setResults] = useState<TransferAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activePreprocessing, setActivePreprocessing] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<TransferMetricType>('centroid');

  // Set active preprocessing when results arrive
  useEffect(() => {
    if (results && results.preprocessings.length > 0 && !activePreprocessing) {
      setActivePreprocessing(results.preprocessings[0]);
    }
  }, [results, activePreprocessing]);

  const handleRunAnalysis = useCallback(async () => {
    if (selectedDatasets.length < 2) {
      setError('Please select at least 2 datasets for transfer analysis.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await computeTransferAnalysis({
        dataset_ids: selectedDatasets,
        preprocessing: preprocessingConfig,
        n_components: nComponents,
        knn: knn,
      });

      setResults(response);
      if (response.preprocessings.length > 0) {
        setActivePreprocessing(response.preprocessings[0]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDatasets, preprocessingConfig, nComponents, knn]);

  return (
    <motion.div
      className="h-full flex flex-col lg:flex-row gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Left Sidebar - Configuration */}
      <motion.aside
        variants={itemVariants}
        className="w-full lg:w-80 lg:shrink-0 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-lg">Transfer Analysis</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <TransferAnalysisForm
              selectedDatasets={selectedDatasets}
              onDatasetsChange={setSelectedDatasets}
              preprocessingConfig={preprocessingConfig}
              onPreprocessingChange={setPreprocessingConfig}
              nComponents={nComponents}
              onNComponentsChange={setNComponents}
              knn={knn}
              onKnnChange={setKnn}
            />

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={handleRunAnalysis}
              disabled={isLoading || selectedDatasets.length < 2}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Run Analysis
                </>
              )}
            </Button>

            {selectedDatasets.length < 2 && (
              <p className="text-xs text-muted-foreground text-center">
                Select at least 2 datasets to compare
              </p>
            )}
          </CardContent>
        </Card>
      </motion.aside>

      {/* Main Content - Results */}
      <motion.main
        variants={itemVariants}
        className="flex-1 min-w-0 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        {results ? (
          <ResultsPanel
            results={results}
            activePreprocessing={activePreprocessing}
            onPreprocessingChange={setActivePreprocessing}
            selectedMetric={selectedMetric}
            onMetricChange={setSelectedMetric}
          />
        ) : (
          <Card className="h-full min-h-[400px] flex items-center justify-center">
            <CardContent className="text-center py-12">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-muted mb-4">
                <ArrowLeftRight className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No Results Yet</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-4">
                Select datasets and configure preprocessing options, then click "Run Analysis"
                to evaluate transfer learning potential between your datasets.
              </p>
              <div className="flex flex-wrap gap-2 justify-center text-xs text-muted-foreground">
                <span className="px-2 py-1 bg-muted rounded">Compare multiple datasets</span>
                <span className="px-2 py-1 bg-muted rounded">Evaluate preprocessing impact</span>
                <span className="px-2 py-1 bg-muted rounded">PCA-based metrics</span>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.main>
    </motion.div>
  );
}
