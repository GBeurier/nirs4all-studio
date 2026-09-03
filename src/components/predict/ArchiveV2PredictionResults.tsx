import { RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ArchiveV2ArrayPredictionResponse } from "@/types/archiveV2Prediction";

interface ArchiveV2PredictionResultsProps {
  result: ArchiveV2ArrayPredictionResponse;
  onReset: () => void;
}

export function ArchiveV2PredictionResults({
  result,
  onReset,
}: ArchiveV2PredictionResultsProps) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>Archive V2 predictions</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{result.sample_ids.length} samples</Badge>
              <Badge variant="outline">{result.target_names.length} targets</Badge>
              <Badge variant="outline">Rust/Core/Methods</Badge>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {result.archive_id} · {result.archive_sha256}
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sample</TableHead>
              {result.target_names.map((target) => (
                <TableHead key={target} className="text-right">{target}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.sample_ids.map((sampleId, rowIndex) => (
              <TableRow key={sampleId}>
                <TableCell className="font-mono text-xs">{sampleId}</TableCell>
                {result.values[rowIndex].map((value, columnIndex) => (
                  <TableCell
                    key={result.target_names[columnIndex]}
                    className="text-right font-mono"
                  >
                    {Number(value).toPrecision(8)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
