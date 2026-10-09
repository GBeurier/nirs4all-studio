import { useTranslation } from "react-i18next";
import { Download, RotateCcw } from "lucide-react";

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
import type {
  ArchiveV2ArrayPredictionResponse,
  ArchiveV2ConformalPresentation,
} from "@/types/archiveV2Prediction";
import {
  downloadBlob,
  sanitizeFilename,
} from "@/components/predictions/viewer/export";

import { buildArchiveV2PredictionCsv } from "./archiveV2PredictionCsv";

interface ArchiveV2PredictionResultsProps {
  result: ArchiveV2ArrayPredictionResponse;
  conformal: ArchiveV2ConformalPresentation | null;
  conformalError: string | null;
  onReset: () => void;
}

export function ArchiveV2PredictionResults({
  result,
  conformal,
  conformalError,
  onReset,
}: ArchiveV2PredictionResultsProps) {
  const { t } = useTranslation();
  const exportCsv = () => {
    const csv = buildArchiveV2PredictionCsv(result, conformal);
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `archive-v2-predictions-${sanitizeFilename(result.archive_id)}.csv`,
    );
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>{t("predict.archiveResults.title")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{t("predict.view.samplesCount", { count: result.sample_ids.length })}</Badge>
              <Badge variant="outline">{t("predict.archiveResults.targetsCount", { count: result.target_names.length })}</Badge>
              <Badge variant="outline">Rust/Core/Methods</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" /> {t("predict.results.export.csv")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="mr-2 h-4 w-4" /> {t("common.reset")}
            </Button>
          </div>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {result.archive_id} · {result.archive_sha256}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("predict.results.table.sample")}</TableHead>
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
        {conformal ? (
          <div className="space-y-4" data-testid="conformal-presentation">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{t("predict.archiveResults.conformalIntervals")}</Badge>
              <Badge variant="outline">
                {conformal.guarantee.multi_target_policy}
              </Badge>
              <Badge variant="outline">
                {t("predict.archiveResults.calibrationSamples", { count: conformal.guarantee.calibration_sample_count })}
              </Badge>
              <Badge variant="outline">
                {t("predict.archiveResults.smallSample", { policy: conformal.guarantee.small_sample_policy })}
              </Badge>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {t("predict.archiveResults.presentation", { fingerprint: conformal.presentation_fingerprint })}
            </p>
            {conformal.interval_block.intervals.map((interval) => (
              <div key={interval.coverage} className="space-y-2">
                <p className="text-sm font-semibold">
                  {t("predict.archiveResults.coverage", { coverage: interval.coverage })}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("predict.results.table.sample")}</TableHead>
                      {conformal.target_names.map((target) => (
                        <TableHead key={target} className="text-right">
                          {t("predict.archiveResults.intervalColumn", { target })}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conformal.sample_ids.map((sampleId, rowIndex) => (
                      <TableRow key={sampleId}>
                        <TableCell className="font-mono text-xs">
                          {sampleId}
                        </TableCell>
                        {interval.cells[rowIndex].map((cell, columnIndex) => (
                          <TableCell
                            key={conformal.target_names[columnIndex]}
                            className="text-right font-mono"
                          >
                            {cell.status === "unbounded"
                              ? t("predict.archiveResults.unbounded")
                              : `[${cell.lower.toPrecision(8)}, ${cell.upper.toPrecision(8)}]`}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            <div className="space-y-1 text-xs text-muted-foreground">
              {conformal.guarantee.quantiles.map((quantile) => (
                <p key={quantile.coverage}>
                  {t("predict.archiveResults.quantile", {
                    coverage: quantile.coverage,
                    rank: quantile.rank,
                    radii: quantile.radii.map((radius) =>
                      radius.status === "unbounded" ? t("predict.archiveResults.unboundedLower") : radius.value,
                    ).join(", "),
                  })}
                </p>
              ))}
            </div>
          </div>
        ) : conformalError ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("predict.archiveResults.noConformal", { error: conformalError })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
