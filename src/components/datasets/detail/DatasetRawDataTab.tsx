/**
 * DatasetRawDataTab - Paginated raw data table for dataset detail page
 *
 * Note: Requires backend endpoint GET /datasets/{id}/samples for full functionality
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { Dataset, PreviewDataResponse } from "@/types/datasets";

interface DatasetRawDataTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

// Placeholder for paginated samples response
interface SamplesResponse {
  samples: Array<{
    id: string;
    values: Record<string, number | string>;
  }>;
  total_count: number;
  offset: number;
  limit: number;
  columns: string[];
}

export function DatasetRawDataTab({
  dataset,
  preview,
  loading,
  error,
  onRefresh,
}: DatasetRawDataTabProps) {
  const [partition, setPartition] = useState<"all" | "train" | "test">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  // For now, we show preview data if available, otherwise placeholder
  // TODO: Integrate with GET /datasets/{id}/samples endpoint when available

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

  // Check if we have sample data from preview
  const hasSampleData = preview?.summary?.num_samples && preview.summary.num_samples > 0;

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

  // Mock data for demonstration - replace with actual API call
  const mockColumns = ["ID", "Protein", "Moisture", "Batch", "Origin"];
  const mockData = Array.from({ length: Math.min(pageSize, preview.summary.num_samples) }, (_, i) => ({
    id: `SAMPLE_${String(currentPage * pageSize + i + 1).padStart(4, "0")}`,
    values: {
      ID: `SAMPLE_${String(currentPage * pageSize + i + 1).padStart(4, "0")}`,
      Protein: (10 + Math.random() * 4).toFixed(2),
      Moisture: (10 + Math.random() * 3).toFixed(2),
      Batch: `B${Math.floor(Math.random() * 5) + 1}`,
      Origin: `Farm ${String.fromCharCode(65 + Math.floor(Math.random() * 5))}`,
    },
  }));

  const totalPages = Math.ceil((preview.summary.num_samples || 0) / pageSize);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search samples..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={partition} onValueChange={(v) => setPartition(v as typeof partition)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Partition" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Data</SelectItem>
            <SelectItem value="train">Train Only</SelectItem>
            <SelectItem value="test">Test Only</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Info banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3">
          <p className="text-sm text-amber-600">
            Showing preview data. Full paginated view requires the samples API endpoint.
          </p>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="h-4 w-4" />
              Raw Data Preview
              <Badge variant="secondary" className="ml-2">
                {preview.summary.num_samples.toLocaleString()} samples
              </Badge>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  {mockColumns.map((col) => (
                    <TableHead key={col} className="text-xs font-medium">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockData.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    {mockColumns.map((col) => (
                      <TableCell key={col} className="font-mono text-xs">
                        {row.values[col]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              Showing {currentPage * pageSize + 1} to{" "}
              {Math.min((currentPage + 1) * pageSize, preview.summary.num_samples)} of{" "}
              {preview.summary.num_samples.toLocaleString()} samples
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
        </CardContent>
      </Card>
    </div>
  );
}
