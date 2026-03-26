import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Box, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue, isLowerBetter, getMetricAbbreviation, extractScoreValue } from "@/lib/scores";
import { ModelActionMenu } from "./ModelActionMenu";
import type { TopChainResult } from "@/types/enriched-runs";

interface PerModelSummaryTableProps {
  chains: TopChainResult[];
  metric: string | null;
  taskType: string | null;
  selectedMetrics: string[];
  runId?: string;
  datasetName: string;
  selectedChainId?: string | null;
  onSelectChain?: (chain: TopChainResult) => void;
  refitOnly?: boolean;
}

/**
 * Per-Model Summary table matching nirs4all's report format.
 * Shows RMSEP, Ens_Test, RMSECV + dynamic metric columns from selectedMetrics.
 */
export function PerModelSummaryTable({
  chains, metric, taskType, selectedMetrics, runId, datasetName,
  selectedChainId, onSelectChain, refitOnly,
}: PerModelSummaryTableProps) {
  const isRegression = taskType !== "classification" && taskType !== "binary_classification" && taskType !== "multiclass_classification";

  const displayChains = refitOnly
    ? chains.filter(c => c.final_test_score != null)
    : chains;

  if (displayChains.length === 0) return null;

  // NIRS-style column labels
  const finalLabel = isRegression ? "RMSEP" : "Final";
  const cvLabel = isRegression ? "RMSECV" : "CV";

  // Determine which fixed columns actually have data (hide fully-empty columns)
  const hasFinalCol = displayChains.some(c => c.final_test_score != null);
  const hasEnsTestCol = displayChains.some(c => c.avg_test_score != null);
  const hasCvCol = displayChains.some(c => c.avg_val_score != null);

  // Filter dynamic metric columns — exclude the primary metric and metrics already shown in fixed columns
  const primaryKey = (metric || "rmse").toLowerCase();
  const fixedKeys = new Set([primaryKey]);
  if (isRegression) fixedKeys.add("rmse");
  const dynamicMetrics = selectedMetrics.filter(k => !fixedKeys.has(k));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent text-[11px]">
            <TableHead className="w-8">#</TableHead>
            <TableHead>Model</TableHead>
            {hasFinalCol && <TableHead className="text-right">{finalLabel}</TableHead>}
            {hasEnsTestCol && <TableHead className="text-right">Ens_Test</TableHead>}
            {hasCvCol && <TableHead className="text-right">{cvLabel}</TableHead>}
            <TableHead className="text-right">Folds</TableHead>
            {dynamicMetrics.map(k => (
              <TableHead key={k} className="text-right text-[10px]">{getMetricAbbreviation(k)}</TableHead>
            ))}
            <TableHead className="text-center">Preproc</TableHead>
            <TableHead className="w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayChains.map((chain, index) => {
            const hasFinal = chain.final_test_score != null;
            const isSelected = selectedChainId === chain.chain_id;
            const rank = index + 1;

            return (
              <TableRow
                key={chain.chain_id}
                className={cn(
                  "cursor-pointer text-xs transition-colors",
                  isSelected && "bg-primary/5 border-l-2 border-l-primary",
                  rank === 1 && hasFinal && "bg-emerald-500/5",
                )}
                onClick={() => onSelectChain?.(chain)}
              >
                <TableCell>
                  <span className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    rank === 1 ? (hasFinal ? "bg-emerald-500/20 text-emerald-500" : "bg-chart-1/20 text-chart-1") : "bg-muted text-muted-foreground",
                  )}>
                    {rank}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {hasFinal && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
                    <Badge variant="outline" className={cn("text-[10px] font-mono shrink-0", hasFinal && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400")}>
                      <Box className="h-2.5 w-2.5 mr-0.5" />
                      {chain.model_name}
                    </Badge>
                  </div>
                </TableCell>
                {hasFinalCol && (
                  <TableCell className="text-right">
                    {hasFinal ? (
                      <span className="font-mono font-semibold text-emerald-500">
                        {formatMetricValue(chain.final_test_score, metric || "rmse")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {hasEnsTestCol && (
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {chain.avg_test_score != null ? formatMetricValue(chain.avg_test_score, metric || "rmse") : "—"}
                  </TableCell>
                )}
                {hasCvCol && (
                  <TableCell className="text-right">
                    <span className="font-mono text-chart-1">
                      {chain.avg_val_score != null ? formatMetricValue(chain.avg_val_score, metric || "rmse") : "—"}
                    </span>
                  </TableCell>
                )}
                <TableCell className="text-right text-muted-foreground">{chain.fold_count || "—"}</TableCell>
                {dynamicMetrics.map(k => {
                  const val = hasFinal
                    ? extractScoreValue(chain.final_scores, k, "test")
                    : chain.scores?.val?.[k] ?? null;
                  return (
                    <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">
                      {val != null ? formatMetricValue(val, k) : "—"}
                    </TableCell>
                  );
                })}
                <TableCell>
                  {chain.preprocessings ? (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[150px] block" title={chain.preprocessings}>
                      {chain.preprocessings}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <ModelActionMenu
                    chainId={chain.chain_id}
                    modelName={chain.model_name}
                    datasetName={datasetName}
                    runId={runId}
                    hasRefit={hasFinal}
                    onViewDetails={() => onSelectChain?.(chain)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
