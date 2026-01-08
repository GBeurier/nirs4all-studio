/**
 * PlaygroundSidebar - Sidebar with operator palette, pipeline builder, and execution status
 *
 * Features:
 * - Unified operator format (preprocessing + splitting)
 * - Backend-fetched operators
 * - Loading and error states
 * - Execution status display
 * - Workspace dataset loading
 * - Export to Pipeline Editor, JSON, and CSV
 */

import { Undo2, Redo2, FlaskConical, Download, Upload, FileJson, Table, ExternalLink, HelpCircle, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DataUpload } from './DataUpload';
import { OperatorPalette } from './OperatorPalette';
import { PipelineBuilder } from './PipelineBuilder';
import { ExecutionStatus } from './ExecutionStatus';
import type { SpectralData } from '@/types/spectral';
import type { UnifiedOperator, OperatorDefinition, StepError, FilterInfo } from '@/types/playground';
import type { WorkspaceDatasetInfo } from '@/hooks/useSpectralData';

interface PlaygroundSidebarProps {
  // Data
  data: SpectralData | null;
  isLoading: boolean;
  error: string | null;
  dataSource: 'workspace' | 'demo' | null;
  currentDatasetInfo: WorkspaceDatasetInfo | null;

  // Pipeline state
  operators: UnifiedOperator[];
  hasSplitter: boolean;
  canUndo: boolean;
  canRedo: boolean;

  // Execution state
  isProcessing: boolean;
  isFetching: boolean;
  isDebouncing: boolean;
  executionTimeMs?: number;
  stepErrors?: StepError[];
  /** Filter statistics from execution result */
  filterInfo?: FilterInfo;

  // Data handlers
  onLoadDemo: () => void;
  onLoadFromWorkspace: (datasetId: string, datasetName: string) => void;
  onClearData: () => void;

  // Pipeline handlers
  onAddOperator: (definition: OperatorDefinition) => void;
  onUpdateOperator: (id: string, updates: Partial<UnifiedOperator>) => void;
  onUpdateOperatorParams: (id: string, params: Record<string, unknown>) => void;
  onRemoveOperator: (id: string) => void;
  onToggleOperator: (id: string) => void;
  onReorderOperators: (fromIndex: number, toIndex: number) => void;
  onClearPipeline: () => void;
  onUndo: () => void;
  onRedo: () => void;

  // Export handlers
  onExportToPipelineEditor?: () => void;
  onExportPipelineJson?: () => void;
  onExportDataCsv?: () => void;
  onImportPipeline?: () => void;
}

export function PlaygroundSidebar({
  data,
  isLoading,
  error,
  dataSource,
  currentDatasetInfo,
  operators,
  hasSplitter,
  canUndo,
  canRedo,
  isProcessing,
  isFetching,
  isDebouncing,
  executionTimeMs,
  stepErrors = [],
  filterInfo,
  onLoadDemo,
  onLoadFromWorkspace,
  onClearData,
  onAddOperator,
  onUpdateOperator,
  onUpdateOperatorParams,
  onRemoveOperator,
  onToggleOperator,
  onReorderOperators,
  onClearPipeline,
  onUndo,
  onRedo,
  onExportToPipelineEditor,
  onExportPipelineJson,
  onExportDataCsv,
  onImportPipeline,
}: PlaygroundSidebarProps) {
  const hasExportOptions = onExportToPipelineEditor || onExportPipelineJson || onExportDataCsv;

  return (
    <TooltipProvider>
      <div className="w-96 bg-card border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground">NIR Lab</h1>
              <p className="text-xs text-muted-foreground">Preprocessing Playground</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={!canUndo}
                  onClick={onUndo}
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>Undo</span>
                  <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Ctrl+Z</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={!canRedo}
                  onClick={onRedo}
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>Redo</span>
                  <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Ctrl+Shift+Z</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={() => window.open('https://nirs4all.readthedocs.io/', '_blank')}
                >
                  <HelpCircle className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="space-y-1">
                  <div className="font-medium">Help & Documentation</div>
                  <div className="text-[10px] text-muted-foreground">
                    Open nirs4all docs in new tab
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Execution status */}
        {data && (
          <div className="mt-2">
            <ExecutionStatus
              isProcessing={isProcessing}
              isFetching={isFetching}
              isDebouncing={isDebouncing}
              executionTimeMs={executionTimeMs}
              errors={stepErrors}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <DataUpload
          data={data}
          isLoading={isLoading}
          error={error}
          dataSource={dataSource}
          currentDatasetInfo={currentDatasetInfo}
          onLoadDemo={onLoadDemo}
          onLoadFromWorkspace={onLoadFromWorkspace}
          onClear={onClearData}
        />

        <Separator />

        {data && (
          <>
            <OperatorPalette
              onAddOperator={onAddOperator}
              hasSplitter={hasSplitter}
            />

            <Separator />

            <PipelineBuilder
              operators={operators}
              isProcessing={isProcessing || isFetching}
              stepErrors={stepErrors}
              filterInfo={filterInfo}
              onUpdate={onUpdateOperator}
              onUpdateParams={onUpdateOperatorParams}
              onRemove={onRemoveOperator}
              onToggle={onToggleOperator}
              onReorder={onReorderOperators}
              onClear={onClearPipeline}
            />
          </>
        )}
      </ScrollArea>

      {/* Footer with export/import */}
      {data && (operators.length > 0 || onImportPipeline) && (
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            {/* Export dropdown */}
            {hasExportOptions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">
                    <Download className="w-3 h-3 mr-1" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {onExportToPipelineEditor && (
                    <DropdownMenuItem onClick={onExportToPipelineEditor}>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span>Open in Pipeline Editor</span>
                        <span className="text-xs text-muted-foreground">
                          Continue editing with full features
                        </span>
                      </div>
                    </DropdownMenuItem>
                  )}
                  {onExportToPipelineEditor && (onExportPipelineJson || onExportDataCsv) && (
                    <DropdownMenuSeparator />
                  )}
                  {onExportPipelineJson && (
                    <DropdownMenuItem onClick={onExportPipelineJson}>
                      <FileJson className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span>Download Pipeline JSON</span>
                        <span className="text-xs text-muted-foreground">
                          nirs4all-compatible format
                        </span>
                      </div>
                    </DropdownMenuItem>
                  )}
                  {onExportDataCsv && (
                    <DropdownMenuItem onClick={onExportDataCsv}>
                      <Table className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span>Download Processed CSV</span>
                        <span className="text-xs text-muted-foreground">
                          Processed spectral data
                        </span>
                      </div>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Import button */}
            {onImportPipeline && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2"
                    onClick={onImportPipeline}
                  >
                    <Upload className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import from Pipeline Editor</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export default PlaygroundSidebar;
