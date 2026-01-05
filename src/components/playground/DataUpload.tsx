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
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sidebar-foreground">
            {dataSource === 'workspace' ? (
              <FolderOpen className="w-4 h-4 text-primary" />
            ) : (
              <Database className="w-4 h-4 text-primary" />
            )}
            <span className="text-sm font-medium">
              {dataSource === 'workspace' && currentDatasetInfo
                ? currentDatasetInfo.datasetName
                : dataSource === 'demo'
                  ? 'Demo Data'
                  : 'Data Loaded'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Data source badge */}
        {dataSource && (
          <div className="text-xs text-muted-foreground capitalize">
            Source: {dataSource}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Samples</div>
            <div className="text-foreground font-mono font-semibold">
              {data.spectra.length}
            </div>
          </div>
          <div className="bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Wavelengths</div>
            <div className="text-foreground font-mono font-semibold">
              {data.wavelengths.length}
            </div>
          </div>
          <div className="col-span-2 bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Range</div>
            <div className="text-foreground font-mono font-semibold">
              {data.wavelengths[0].toFixed(0)} - {data.wavelengths[data.wavelengths.length - 1].toFixed(0)} nm
            </div>
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
