import { BarChart3, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import type {
  PartitionKey,
  PreviewDataResponse,
  SpectraPreview,
  TargetDistribution,
} from "@/types/datasets";
import { SpectraChart, TargetHistogram } from "./charts";
import type { HistogramData } from "./charts/targetHistogramData";
import type { PartitionVisualTheme } from "./partitionTheme";
import { PartitionToggle } from "./PartitionToggle";

export function DatasetQuickViewSpectraTab({
  preview,
  loading,
  error,
  spectraData,
  headerUnit,
  selectedSource,
  onSelectedSourceChange,
  partition,
  onPartitionChange,
  hasTest,
  trainCount,
  testCount,
  partitionTheme,
}: {
  preview: PreviewDataResponse | null | undefined;
  loading: boolean;
  error: string | null;
  spectraData: SpectraPreview | undefined;
  headerUnit: PreviewDataResponse["summary"]["header_unit"] | undefined;
  selectedSource: number;
  onSelectedSourceChange: (source: number) => void;
  partition: PartitionKey;
  onPartitionChange: (partition: PartitionKey) => void;
  hasTest: boolean;
  trainCount: number | undefined;
  testCount: number | undefined;
  partitionTheme: PartitionVisualTheme;
}) {
  return (
    <TabsContent value="spectra" className="m-0 mt-0 h-full min-h-[400px] outline-none">
      {!loading && !error && (
        <Card className="flex flex-col border-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Spectra Preview
              </CardTitle>
              <div className="flex items-center gap-2">
                {preview && preview.summary.n_sources > 1 && preview.spectra_per_source && (
                  <select
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                    value={selectedSource}
                    onChange={(event) => onSelectedSourceChange(Number(event.target.value))}
                  >
                    {Object.keys(preview.spectra_per_source).map((sourceIdx) => (
                      <option key={sourceIdx} value={Number(sourceIdx)}>
                        Source {Number(sourceIdx) + 1}
                      </option>
                    ))}
                  </select>
                )}
                <PartitionToggle
                  value={partition}
                  onChange={onPartitionChange}
                  hasTest={hasTest}
                  trainCount={trainCount}
                  testCount={testCount}
                  size="xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {spectraData ? (
              <SpectraChart
                wavelengths={spectraData.wavelengths}
                meanSpectrum={spectraData.mean_spectrum}
                minSpectrum={spectraData.min_spectrum}
                maxSpectrum={spectraData.max_spectrum}
                width="100%"
                height={260}
                unit={headerUnit}
                lineColor={partitionTheme.lineColor}
                rangeFillColor={partitionTheme.rangeFillColor}
              />
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                No spectra data available
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}

export function DatasetQuickViewTargetsTab({
  loading,
  error,
  distribution,
  histogramData,
  partition,
  onPartitionChange,
  hasTest,
  trainCount,
  testCount,
  partitionTheme,
}: {
  loading: boolean;
  error: string | null;
  distribution: TargetDistribution | undefined;
  histogramData: HistogramData[];
  partition: PartitionKey;
  onPartitionChange: (partition: PartitionKey) => void;
  hasTest: boolean;
  trainCount: number | undefined;
  testCount: number | undefined;
  partitionTheme: PartitionVisualTheme;
}) {
  return (
    <TabsContent value="targets" className="m-0 mt-0 h-full outline-none">
      {!loading && !error && (
        <Card className="flex flex-col border-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                Target Distribution
              </CardTitle>
              <div className="flex items-center gap-2">
                <PartitionToggle
                  value={partition}
                  onChange={onPartitionChange}
                  hasTest={hasTest}
                  trainCount={trainCount}
                  testCount={testCount}
                  size="xs"
                />
                {distribution && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {distribution.type}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {distribution ? (
              <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(140px,1fr)] gap-4 items-start">
                <div>
                  {histogramData.length > 0 ? (
                    <TargetHistogram
                      data={histogramData}
                      type={distribution.type}
                      width="100%"
                      height={200}
                      barColor={partitionTheme.histogramColor}
                    />
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                      No distribution chart available
                    </div>
                  )}
                </div>
                <DatasetTargetStats distribution={distribution} />
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                No target preview available
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}

function DatasetTargetStats({ distribution }: { distribution: TargetDistribution }) {
  if (distribution.type !== "regression") {
    return (
      <div className="space-y-2">
        {distribution.class_counts &&
          Object.entries(distribution.class_counts).map(([label, count]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono font-medium">{count}</span>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <DatasetTargetStat label="Min" value={distribution.min} />
      <DatasetTargetStat label="Max" value={distribution.max} />
      <DatasetTargetStat label="Mean" value={distribution.mean} />
      <DatasetTargetStat label="Std" value={distribution.std} />
    </div>
  );
}

function DatasetTargetStat({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono font-medium">{value?.toFixed(3) || "--"}</p>
    </div>
  );
}
