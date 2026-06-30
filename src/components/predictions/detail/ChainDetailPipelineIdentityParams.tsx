import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatParamValue } from "./ChainDetailPipelineIdentityFormatting";

interface ChainDetailPipelineParamsProps {
  variantParams: Record<string, unknown> | null;
  bestParams: Record<string, unknown> | null;
}

interface ParamsPanelProps {
  tone: "variant" | "best";
  title: string;
  description: string | ReactNode;
  params: Record<string, unknown>;
}

export function ChainDetailPipelineParams({
  variantParams,
  bestParams,
}: ChainDetailPipelineParamsProps) {
  const hasBestParams = !!bestParams && Object.keys(bestParams).length > 0;
  const hasVariantParams = !!variantParams;

  return (
    <>
      {variantParams && (
        <ParamsPanel
          tone="variant"
          title="Variant - sweep selection"
          description={
            <>
              Concrete operator / param values picked from the pipeline's generators (
              <span className="font-mono">_or_</span>,{" "}
              <span className="font-mono">_range_</span>,{" "}
              <span className="font-mono">_grid_</span>...).
            </>
          }
          params={variantParams}
        />
      )}

      {bestParams && Object.keys(bestParams).length > 0 && (
        <ParamsPanel
          tone="best"
          title="Finetune - best params"
          description="Hyperparameters selected by the finetune / optimizer for this model."
          params={bestParams}
        />
      )}

      {!hasVariantParams && !hasBestParams && (
        <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-[11px] text-muted-foreground">
          No sweep variant or finetune best params recorded for this chain.
        </div>
      )}
    </>
  );
}

function ParamsPanel({
  tone,
  title,
  description,
  params,
}: ParamsPanelProps) {
  const isVariant = tone === "variant";
  return (
    <div
      className={cn(
        "mt-4 rounded-xl p-4",
        isVariant
          ? "border border-amber-500/40 bg-amber-500/[0.06]"
          : "border border-primary/30 bg-primary/[0.05]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider",
          isVariant ? "text-amber-700 dark:text-amber-400" : "text-primary",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {title}
        <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
          {Object.keys(params).length} param{Object.keys(params).length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{description}</div>
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {Object.entries(params).map(([key, value]) => (
          <div
            key={key}
            className={cn(
              "flex items-baseline justify-between gap-2 rounded-md bg-background/85 px-2.5 py-1.5",
              isVariant ? "border border-amber-500/30" : "border border-border/60",
            )}
          >
            <span className="truncate text-[11px] font-medium text-muted-foreground" title={key}>
              {key}
            </span>
            <span
              className="truncate font-mono text-xs font-semibold text-foreground"
              title={formatParamValue(value)}
            >
              {formatParamValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
