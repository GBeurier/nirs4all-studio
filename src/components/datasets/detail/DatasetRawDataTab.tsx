/**
 * DatasetRawDataTab - Paginated raw data table for dataset detail page
 *
 * Fetches real data from the spectra API endpoint with pagination support.
 */
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { PartitionToggle } from "../PartitionToggle";
import type { Dataset, PartitionKey, PreviewDataResponse } from "@/types/datasets";
import { getDatasetSpectra, type SpectraResponse } from "@/api/playground";

interface DatasetRawDataTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function DatasetRawDataTab({
  dataset,
  preview,
  loading,
  error,
  onRefresh,
}: DatasetRawDataTabProps) {
  const trainCount = preview?.summary?.train_samples;
  const testCount = preview?.summary?.test_samples;
  const hasTest = testCount != null && testCount > 0;

  const [partition, setPartition] = useState<PartitionKey>("all");
  const effectivePartition: PartitionKey = !hasTest && partition !== "train" ? "train" : partition;
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  // Fetched spectra data state
  const [spectraData, setSpectraData] = useState<SpectraResponse | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Reset page when partition changes
  useEffect(() => {
    setCurrentPage(0);
  }, [effectivePartition]);

  // Check if we have sample data from preview
  const hasSampleData = preview?.summary?.num_samples && preview.summary.num_samples > 0;

  // Fetch actual data when page/partition changes
  useEffect(() => {
    if (!dataset?.id || !hasSampleData) return;

    let cancelled = false;
    const fetchData = async () => {
      setFetchLoading(true);
      setFetchError(null);
      try {
        const start = currentPage * pageSize;
        const end = start + pageSize;
        const data = await getDatasetSpectra(dataset.id, {
          start,
          end,
          partition: effectivePartition,
          includeY: true,
          includeMetadata: true,
        });
        if (!cancelled) setSpectraData(data);
      } catch (e) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : "Failed to fetch data");
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [dataset?.id, currentPage, pageSize, effectivePartition, hasSampleData]);

  // Build columns and rows from real data
  const { columns, rows } = useMemo(() => {
    if (!spectraData) return { columns: [] as string[], rows: [] as Array<{ id: string; values: Record<string, string> }> };

    const cols: string[] = ["#"];

    // Show Y if available
    if (spectraData.y) {
      cols.push("Target (y)");
    }

    // Show metadata columns
    const metaCols = spectraData.metadata_columns || [];
    cols.push(...metaCols);

    // Show a few representative wavelengths
    const wl = spectraData.wavelengths;
    const wlIndices = [0, Math.floor(wl.length / 4), Math.floor(wl.length / 2),
      Math.floor(3 * wl.length / 4), wl.length - 1]
      .filter((v, i, a) => a.indexOf(v) === i);
    const wlCols = wlIndices.map(idx => `\u03BB ${wl[idx]}`);
    cols.push(...wlCols);

    // Build rows
    const dataRows = spectraData.spectra.map((spectrum, i) => {
      const globalIdx = spectraData.start + i;
      const values: Record<string, string> = {};

      values["#"] = String(globalIdx + 1);

      if (spectraData.y) {
        const yVal = spectraData.y[i];
        values["Target (y)"] = yVal != null ? Number(yVal).toFixed(4) : "--";
      }

      for (const col of metaCols) {
        const metaValues = spectraData.metadata?.[col];
        values[col] = metaValues && i < metaValues.length
          ? String(metaValues[i] ?? "--")
          : "--";
      }

      for (let j = 0; j < wlIndices.length; j++) {
        values[wlCols[j]] = spectrum[wlIndices[j]]?.toFixed(4) ?? "--";
      }

      return { id: `sample_${globalIdx}`, values };
    });

    return { columns: cols, rows: dataRows };
  }, [spectraData]);

  const totalSamples = spectraData?.total_samples ?? preview?.summary?.num_samples ?? 0;
  const totalPages = Math.ceil(totalSamples / pageSize);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading raw data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">Failed to load data</p>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          {error}
        </p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!hasSampleData) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <TableIcon className="h-8 w-8 text-muted-foreground mb-4 opacity-50" />
        <p className="text-muted-foreground mb-2">No raw data available</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Load the dataset preview to see sample data.
        </p>
        <Button onClick={onRefresh} variant="outline" className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Load Data
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <PartitionToggle
          value={effectivePartition}
          onChange={setPartition}
          hasTest={hasTest}
          trainCount={trainCount}
          testCount={testCount}
        />
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="h-4 w-4" />
              Raw Data
              <Badge variant="secondary" className="ml-2">
                {totalSamples.toLocaleString()} samples
              </Badge>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {fetchLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
              <span className="text-muted-foreground text-sm">Loading page...</span>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-6 w-6 text-destructive mb-2" />
              <p className="text-sm text-destructive">{fetchError}</p>
            </div>
          ) : rows.length > 0 ? (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    {columns.map((col) => (
                      <TableHead key={col} className="text-xs font-medium whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-muted/30">
                      {columns.map((col) => (
                        <TableCell key={col} className="font-mono text-xs whitespace-nowrap">
                          {row.values[col]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data for this partition.</p>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {currentPage * pageSize + 1} to{" "}
                {Math.min((currentPage + 1) * pageSize, totalSamples)} of{" "}
                {totalSamples.toLocaleString()} samples
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
