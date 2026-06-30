import {
  AlertCircle,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { getDatasetTaskLabel } from "@/lib/datasetTask";
import type {
  Dataset,
  PreviewDataResponse,
  SpectraPreview,
} from "@/types/datasets";
import {
  getMetadataCloudItemStyle,
  getWavelengthRangeLabel,
  getWavelengthRangeTitle,
  getWavelengthResolutionLabel,
} from "./DatasetQuickViewData";

export function DatasetQuickViewOverviewTab({
  dataset,
  preview,
  spectraData,
  wavelengthUnitSymbol,
  wavelengthUnitSuffix,
  waitingForWorkspace,
  loading,
  error,
  onRetry,
}: {
  dataset: Dataset;
  preview: PreviewDataResponse | null | undefined;
  spectraData: SpectraPreview | undefined;
  wavelengthUnitSymbol: string;
  wavelengthUnitSuffix: string;
  waitingForWorkspace: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <TabsContent value="overview" className="m-0 mt-0 space-y-3 p-4 outline-none overflow-y-auto h-full">
      <DatasetQuickViewStatus
        waitingForWorkspace={waitingForWorkspace}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
      {!loading && !error && (
        <>
          <DatasetTargetsCard dataset={dataset} />
          <DatasetMetadataCard metadataColumns={preview?.summary?.metadata_columns ?? []} />
          <DatasetSpectralPropertiesCard
            spectraData={spectraData}
            wavelengthUnitSymbol={wavelengthUnitSymbol}
            wavelengthUnitSuffix={wavelengthUnitSuffix}
          />
          <DatasetDetailsCard dataset={dataset} />
        </>
      )}
    </TabsContent>
  );
}

function DatasetQuickViewStatus({
  waitingForWorkspace,
  loading,
  error,
  onRetry,
}: {
  waitingForWorkspace: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground text-sm">
          {waitingForWorkspace ? "Loading workspace..." : "Loading preview..."}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2 text-sm">Failed to load</p>
        <p className="text-xs text-muted-foreground mb-4 text-center">{error}</p>
        <Button onClick={onRetry} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return null;
}

function DatasetTargetsCard({ dataset }: { dataset: Dataset }) {
  return (
    <Card className="border-0 shadow-none bg-muted/20">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> Targets & Types
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <p className="font-semibold text-sm mb-1">
          {getDatasetTaskLabel(dataset.task_type, {
            numClasses: dataset.num_classes,
            fallback: "Auto",
          })}
        </p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {dataset.targets && dataset.targets.length > 0 ? (
            dataset.targets.map((target) => (
              <Badge
                key={target.column}
                variant={target.column === dataset.default_target ? "default" : "outline"}
                className="text-[10px]"
              >
                {target.column}
                {target.unit && ` (${target.unit})`}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No targets</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetMetadataCard({
  metadataColumns,
}: {
  metadataColumns: string[];
}) {
  return (
    <Card className="border-0 shadow-none bg-muted/20">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <Hash className="h-3.5 w-3.5" /> Metadata Fields
          {metadataColumns.length > 0 && (
            <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground/80">
              {metadataColumns.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {metadataColumns.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">No metadata columns</span>
        ) : (
          <div className="flex flex-wrap gap-1.5 items-center">
            {metadataColumns.map((column, index) => (
              <span
                key={column}
                className={`inline-flex items-center rounded-md border font-mono leading-none whitespace-nowrap ${getMetadataCloudItemStyle(column, index)}`}
                title={column}
              >
                {column}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DatasetSpectralPropertiesCard({
  spectraData,
  wavelengthUnitSymbol,
  wavelengthUnitSuffix,
}: {
  spectraData: SpectraPreview | undefined;
  wavelengthUnitSymbol: string;
  wavelengthUnitSuffix: string;
}) {
  return (
    <Card className="border-0 shadow-none bg-muted/20">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> Spectral Properties
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">
              {getWavelengthRangeTitle(wavelengthUnitSymbol)}
            </p>
            <p className="text-sm font-semibold">
              {getWavelengthRangeLabel(spectraData, wavelengthUnitSuffix)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Resolution</p>
            <p className="text-sm font-semibold">
              {getWavelengthResolutionLabel(spectraData, wavelengthUnitSuffix)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetDetailsCard({ dataset }: { dataset: Dataset }) {
  return (
    <Card className="border-0 shadow-sm border-border">
      <CardHeader className="pb-2 pt-3 px-3 border-b border-border/50">
        <CardTitle className="text-xs text-muted-foreground">Dataset Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 py-3">
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Original Data Path</p>
          <p className="font-mono text-[11px] truncate break-all" title={dataset.path}>
            {dataset.path}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Storage Location</p>
          <p className="font-mono text-[11px] truncate break-all" title={dataset.storage_path}>
            {dataset.storage_path}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {dataset.version && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Version</p>
              <p className="text-xs font-medium">{dataset.version}</p>
            </div>
          )}
          {dataset.hash && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">File Hash</p>
              <p className="font-mono text-[11px] truncate" title={dataset.hash}>
                {dataset.hash.substring(0, 16)}...
              </p>
            </div>
          )}
          {dataset.last_verified && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Last Verified</p>
              <p className="text-xs font-mono">
                {new Date(dataset.last_verified).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
        {dataset.description && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Description</p>
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
              {dataset.description}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
