import { useMemo, useState } from "react";
import { Archive, ChevronDown } from "lucide-react";
import { exportWorkspaceRobustnessReport } from "@/api/aggregatedPredictions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/playground/exportDownload";
import { cn } from "@/lib/utils";
import type { RobustnessReportExportFormat } from "@/types/aggregated-predictions";
import type { ChainDetailArtifactSummary as ChainDetailArtifactSummaryData } from "./useChainDetailPanelState";

interface ChainDetailArtifactSummaryProps {
  summary: ChainDetailArtifactSummaryData;
}

const ROBUSTNESS_REPORT_EXPORTS: Array<{
  extension: string;
  format: RobustnessReportExportFormat;
  label: string;
}> = [
  { extension: "json", format: "json", label: "JSON" },
  { extension: "md", format: "markdown", label: "Markdown" },
  { extension: "html", format: "html", label: "HTML" },
];

interface RobustnessReportExportItem {
  id: string;
  label: string;
  robustnessId: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function robustnessExportFilename(robustnessId: string, extension: string): string {
  const stem = robustnessId.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "")
    || "robustness-report";
  return `${stem}.${extension}`;
}

function exportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "Failed to export robustness report.";
}

function buildRobustnessReportExportItems(summary: ChainDetailArtifactSummaryData): RobustnessReportExportItem[] {
  return summary.refs.flatMap((ref) => {
    if (ref.role !== "robustness-summary") return [];
    const robustnessId = stringOrNull(ref.metadata?.robustness_id) ?? stringOrNull(ref.artifactId);
    if (!robustnessId) return [];
    return [{
      id: `robustness-export:${ref.id}`,
      label: ref.label || "Robustness report",
      robustnessId,
    }];
  });
}

export function ChainDetailArtifactSummary({ summary }: ChainDetailArtifactSummaryProps) {
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const robustnessExportItems = useMemo(
    () => buildRobustnessReportExportItems(summary),
    [summary],
  );

  const handleRobustnessExport = async (
    item: RobustnessReportExportItem,
    format: RobustnessReportExportFormat,
    extension: string,
  ) => {
    const exportKey = `${item.robustnessId}:${format}`;
    if (exportingKey) return;
    setExportingKey(exportKey);
    setExportError(null);
    try {
      const blob = await exportWorkspaceRobustnessReport(item.robustnessId, format);
      downloadBlob(blob, robustnessExportFilename(item.robustnessId, extension));
    } catch (error) {
      setExportError(exportErrorMessage(error));
    } finally {
      setExportingKey(null);
    }
  };

  if (summary.totalCount === 0) return null;

  return (
    <details className="group rounded-xl border border-border/70 bg-card/40 open:bg-card/70">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2",
          "rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">Artifacts and provenance</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {summary.totalCountLabel}
          </Badge>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="space-y-3 border-t border-border/60 px-3 py-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {[...summary.kindItems, ...summary.statusItems].map(item => (
            <Badge key={item.id} variant="secondary" className="text-[10px]">
              {item.label}: {item.artifactCountLabel}
            </Badge>
          ))}
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          {summary.provenanceGroups.map(group => (
            <div key={group.id} className="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{group.label}</p>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">
                    {group.artifactLabels.join(", ")}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {group.artifactCountLabel}
                </Badge>
              </div>
            </div>
          ))}
        </div>

        {summary.auditItems.length > 0 && (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
            <p className="text-xs font-medium text-foreground">Audit metadata</p>
            <div className="mt-2 space-y-2">
              {summary.auditItems.map(item => (
                <div key={item.id}>
                  <p className="text-[11px] font-medium text-foreground">{item.label}</p>
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                    {item.detailLabels.join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {robustnessExportItems.length > 0 && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <p className="text-xs font-medium text-foreground">Robustness report exports</p>
            <div className="mt-2 space-y-2">
              {robustnessExportItems.map(item => (
                <div key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-foreground">{item.label}</p>
                    <p className="break-words text-[11px] text-muted-foreground">
                      Report id <code>{item.robustnessId}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ROBUSTNESS_REPORT_EXPORTS.map((exportTarget) => {
                      const exportKey = `${item.robustnessId}:${exportTarget.format}`;
                      return (
                        <Button
                          key={exportTarget.format}
                          disabled={!!exportingKey}
                          onClick={() => void handleRobustnessExport(item, exportTarget.format, exportTarget.extension)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {exportingKey === exportKey ? "Exporting..." : exportTarget.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {exportError && (
              <p className="mt-2 text-[11px] text-destructive">{exportError}</p>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
