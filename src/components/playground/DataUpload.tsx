/**
 * DataUpload - Data upload component with workspace and demo support
 *
 * Supports:
 * - Workspace dataset selection (primary)
 * - Demo data generation
 */

import { useCallback, useState, useEffect } from 'react';
import {
  Trash2,
  FolderOpen,
  Loader2,
  FlaskConical,
  Database,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { SpectralData } from '@/types/spectral';
import { getWorkspace, type DatasetInfo } from '@/api/client';
import type { WorkspaceDatasetInfo } from '@/hooks/useSpectralData';
import { cn } from '@/lib/utils';

interface DataUploadProps {
  data: SpectralData | null;
  isLoading: boolean;
  error: string | null;
  dataSource: 'workspace' | 'demo' | null;
  currentDatasetInfo: WorkspaceDatasetInfo | null;
  onLoadDemo: () => void;
  onLoadFromWorkspace: (datasetId: string, datasetName: string) => void;
  onClear: () => void;
  /** Whether to show the dataset selector even when data is loaded */
  showDatasetSelector?: boolean;
  /** Callback to toggle the dataset selector visibility */
  onToggleDatasetSelector?: () => void;
}

export function DataUpload({
  data,
  isLoading,
  error,
  dataSource,
  currentDatasetInfo,
  onLoadDemo,
  onLoadFromWorkspace,
  onClear,
  showDatasetSelector = false,
  onToggleDatasetSelector,
}: DataUploadProps) {
  const [workspaceDatasets, setWorkspaceDatasets] = useState<DatasetInfo[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true); // Start as loading
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Fetch workspace datasets on mount
  useEffect(() => {
    let cancelled = false;

    getWorkspace()
      .then(response => {
        if (!cancelled) {
          setWorkspaceDatasets(response.datasets || []);
          setWorkspaceLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setWorkspaceError(err.detail || err.message || 'Failed to load workspace');
          setWorkspaceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDatasetSelect = useCallback((dataset: DatasetInfo) => {
    onLoadFromWorkspace(dataset.id, dataset.name);
  }, [onLoadFromWorkspace]);

  // Data loaded view (but can show selector if showDatasetSelector is true)
  if (data && !showDatasetSelector) {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 shrink-0 rounded bg-primary/10 flex items-center justify-center">
              {dataSource === 'demo' ? (
                <FlaskConical className="h-3.5 w-3.5 text-primary" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 text-primary" />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate leading-tight" title={
                dataSource === 'workspace' && currentDatasetInfo
                  ? currentDatasetInfo.datasetName
                  : undefined
              }>
                {dataSource === 'workspace' && currentDatasetInfo
                  ? currentDatasetInfo.datasetName
                  : dataSource === 'demo'
                    ? 'Demo Data'
                    : 'Loaded Data'}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                 <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                  {dataSource === 'workspace' ? 'Workspace' : dataSource === 'demo' ? 'Synthetic' : 'Data'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onToggleDatasetSelector && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onToggleDatasetSelector}
                title="Change dataset"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive -mr-1"
              onClick={onClear}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Compact Stats Container */}
        <div className="bg-muted/30 rounded-md border border-border/40 divide-y divide-border/40">
           <div className="grid grid-cols-2 divide-x divide-border/40">
             <div className="p-2 pl-3 flex justify-between items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Samples</span>
                <span className="font-mono text-xs">{data.spectra.length}</span>
             </div>
             <div className="p-2 pr-3 flex justify-between items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Points</span>
                <span className="font-mono text-xs">{data.wavelengths.length}</span>
             </div>
           </div>
           <div className="p-2 px-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Range</span>
              <span className="font-mono text-xs text-foreground">
                 {Number.isFinite(data.wavelengths[0]) ? data.wavelengths[0].toFixed(0) : '0'} - {Number.isFinite(data.wavelengths[data.wavelengths.length - 1]) ? data.wavelengths[data.wavelengths.length - 1].toFixed(0) : String(data.wavelengths.length - 1)} nm
              </span>
           </div>
        </div>
      </div>
    );
  }

  // Data selection view - workspace datasets as primary source
  return (
    <div className="p-3 space-y-3 relative">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3 rounded-md">
          <div className="relative">
            <div className="h-10 w-10 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">Loading dataset...</span>
        </div>
      )}

      {/* Header with back button when changing dataset */}
      {showDatasetSelector && data && onToggleDatasetSelector && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Select Dataset</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={onToggleDatasetSelector}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
          {error}
        </div>
      )}

      {/* Workspace datasets section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <FolderOpen className="w-3.5 h-3.5" />
          <span>From Workspace</span>
          {workspaceLoading && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
        </div>

        {/* Workspace error */}
        {!workspaceLoading && workspaceError && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 text-center">
            <FolderOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
            No workspace connected
          </div>
        )}

        {/* Dataset list */}
        {!workspaceLoading && !workspaceError && (
          <>
            {workspaceDatasets.length === 0 ? (
              <div className="bg-muted/30 rounded-md p-4 text-center border border-dashed border-border">
                <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No datasets available</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Link a dataset folder to get started</p>
              </div>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-1.5 pr-2">
                  {workspaceDatasets.map(dataset => (
                    <button
                      key={dataset.id}
                      onClick={() => handleDatasetSelect(dataset)}
                      disabled={isLoading}
                      className={cn(
                        "w-full text-left p-2.5 rounded-md transition-all",
                        "border border-border/50 bg-card/50",
                        "hover:bg-primary/5 hover:border-primary/30 hover:shadow-sm",
                        "focus:bg-primary/5 focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20",
                        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card/50 disabled:hover:border-border/50",
                        "group"
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 shrink-0 rounded-md bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                          <Database className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {dataset.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {dataset.samples && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                                {dataset.samples.toLocaleString()} samples
                              </Badge>
                            )}
                            {dataset.features && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                                {dataset.features.toLocaleString()} features
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Demo data button - always visible */}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onLoadDemo}
        disabled={isLoading}
      >
        <FlaskConical className="w-4 h-4 mr-2" />
        Load Demo Data
      </Button>
    </div>
  );
}
