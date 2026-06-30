import { ChainDetailAdditionalCvMetrics } from "./ChainDetailPipelineIdentityCvMetrics";
import { ChainDetailIdentityRows } from "./ChainDetailPipelineIdentityRows";
import { ChainDetailPipelineParams } from "./ChainDetailPipelineIdentityParams";
import { ChainDetailPipelineTreePreview } from "./ChainDetailPipelineIdentityTreePreview";
import type { ChainDetailPipelineIdentityProps } from "./ChainDetailPipelineIdentityTypes";

export function ChainDetailPipelineIdentity({
  title,
  modelClass,
  pipelineName,
  pipelineStats,
  pipelineTree,
  variantParams,
  bestParams,
  branchPathLabel,
  generatorChoiceCount,
  additionalCvMetricRows,
  cvFoldCount,
}: ChainDetailPipelineIdentityProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="text-sm font-semibold tracking-tight">Pipeline and identity</div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{title}</div>

      {pipelineStats && pipelineTree && (
        <ChainDetailPipelineTreePreview
          pipelineStats={pipelineStats}
          pipelineTree={pipelineTree}
        />
      )}

      <ChainDetailPipelineParams
        variantParams={variantParams}
        bestParams={bestParams}
      />

      <ChainDetailIdentityRows
        branchPathLabel={branchPathLabel}
        generatorChoiceCount={generatorChoiceCount}
        modelClass={modelClass}
        pipelineName={pipelineName}
      />

      {additionalCvMetricRows.length > 0 && (
        <ChainDetailAdditionalCvMetrics
          rows={additionalCvMetricRows}
          cvFoldCount={cvFoldCount}
        />
      )}
    </div>
  );
}
