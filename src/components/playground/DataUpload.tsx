/**
 * DataUpload - Data upload component with file, demo, and workspace support
 *
 * Supports:
 * - File upload (drag & drop, file picker)
 * - Demo data generation
 * - Workspace dataset selection
 */

import { useCallback, useState, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  Database,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SpectralData } from '@/types/spectral';
import { getWorkspace, type DatasetInfo } from '@/api/client';
import type { WorkspaceDatasetInfo } from '@/hooks/useSpectralData';

interface DataUploadProps {
  data: SpectralData | null;
  isLoading: boolean;
  error: string | null;
  dataSource: 'file' | 'workspace' | 'demo' | null;
  currentDatasetInfo: WorkspaceDatasetInfo | null;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  onLoadFromWorkspace: (datasetId: string, datasetName: string) => void;
  onClear: () => void;
}

export function DataUpload({
  data,
  isLoading,
  error,
  dataSource,
  currentDatasetInfo,
  onLoadFile,
  onLoadDemo,
  onLoadFromWorkspace,
  onClear,
}: DataUploadProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceDatasets, setWorkspaceDatasets] = useState<DatasetInfo[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Fetch workspace datasets when collapsible opens
  useEffect(() => {
    if (workspaceOpen && workspaceDatasets.length === 0 && !workspaceLoading) {
      const abortController = new AbortController();
      setWorkspaceLoading(true);
      setWorkspaceError(null);

      getWorkspace()
        .then(response => {
          if (!abortController.signal.aborted) {
            setWorkspaceDatasets(response.datasets || []);
          }
        })
        .catch(err => {
          if (!abortController.signal.aborted) {
            setWorkspaceError(err.detail || 'Failed to load workspace');
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setWorkspaceLoading(false);
          }
        });

      return () => {
        abortController.abort();
      };
    }
  }, [workspaceOpen, workspaceDatasets.length, workspaceLoading]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile]
  );

  const handleDatasetSelect = useCallback((dataset: DatasetInfo) => {
    onLoadFromWorkspace(dataset.id, dataset.name);
    setWorkspaceOpen(false);
  }, [onLoadFromWorkspace]);

  // Data loaded view
  if (data) {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 shrink-0 rounded bg-primary/10 flex items-center justify-center">
              {dataSource === 'workspace' ? (
                <FolderOpen className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Database className="h-3.5 w-3.5 text-primary" />
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
                    : 'Uploaded File'}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                 <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                  {dataSource === 'workspace' ? 'Workspace' : dataSource === 'demo' ? 'Example' : 'Local'}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive -mr-1"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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
                 {data.wavelengths[0].toFixed(0)} - {data.wavelengths[data.wavelengths.length - 1].toFixed(0)} nm
              </span>
           </div>
        </div>
      </div>
    );
  }

  // Data upload view
  return (
    <div className="p-4 space-y-3">
      {/* File upload drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-lg p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag & drop CSV file
            </p>
            <label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                asChild
              >
                <span>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Browse Files
                </span>
              </Button>
            </label>
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
          {error}
        </div>
      )}

      {/* Workspace datasets collapsible */}
      <Collapsible open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-muted-foreground hover:text-foreground"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              <span>From Workspace</span>
            </div>
            {workspaceOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="border rounded-md">
            {workspaceLoading ? (
              <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading datasets...</span>
              </div>
            ) : workspaceError ? (
              <div className="p-4 text-xs text-destructive">
                {workspaceError}
              </div>
            ) : workspaceDatasets.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No datasets in workspace.
                <br />
                Add datasets in the Datasets page.
              </div>
            ) : (
              <ScrollArea className="h-[180px]">
                <div className="p-1">
                  {workspaceDatasets.map(dataset => (
                    <button
                      key={dataset.id}
                      onClick={() => handleDatasetSelect(dataset)}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-sm"
                    >
                      <div className="font-medium truncate">
                        {dataset.name}
                      </div>
                      {(dataset.samples || dataset.features) && (
                        <div className="text-xs text-muted-foreground">
                          {dataset.samples && `${dataset.samples} samples`}
                          {dataset.samples && dataset.features && ' • '}
                          {dataset.features && `${dataset.features} features`}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Demo data button */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground hover:text-foreground"
        onClick={onLoadDemo}
        disabled={isLoading}
      >
        <Database className="w-4 h-4 mr-2" />
        Load Demo Data
      </Button>
    </div>
  );
}
