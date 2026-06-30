import type { KeyboardNavigationReturn, PanelFocus } from "@/hooks/useKeyboardNavigation";
import type { UseDatasetBindingReturn } from "@/hooks/useDatasetBinding";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";
import {
  DatasetBindingProvider,
  NodeRegistryProvider,
  OperatorAvailabilityProvider,
  PipelineEditorPreferencesProvider,
} from "./contexts";
import { FocusPanelRing } from "./FocusIndicator";
import { PipelineTree } from "./PipelineTree";
import { PipelineYAMLView } from "./PipelineYAMLView";
import { StepConfigPanel } from "./StepConfigPanel";
import { StepPalette } from "./StepPalette";
import type { PipelineStep, StepOption, StepType } from "./types";

interface PipelineEditorWorkspaceProps {
  steps: PipelineStep[];
  pipelineName: string;
  pipelineConfig: PipelineConfig;
  selectedStepId: string | null;
  selectedStep: PipelineStep | null;
  viewMode: "tree" | "code";
  focusedPanel: PanelFocus;
  panelRefs: KeyboardNavigationReturn["panelRefs"];
  onFocusPanel: (panel: PanelFocus) => void;
  onAddStep: (type: StepType, option: StepOption) => void;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranch: (stepId: string, path?: string[]) => void;
  onRemoveBranch: (stepId: string, branchIndex: number, path?: string[]) => void;
  onAddChild: (stepId: string, path?: string[]) => void;
  onRemoveChild: (stepId: string, childId: string, path?: string[]) => void;
  onUpdateStep: (id: string, updates: Partial<PipelineStep>) => void;
  datasetBinding: Pick<
    UseDatasetBindingReturn,
    | "boundDataset"
    | "datasets"
    | "isLoading"
    | "bindDataset"
    | "clearBinding"
    | "selectTarget"
    | "refreshDatasets"
  >;
}

export function PipelineEditorWorkspace({
  steps,
  pipelineName,
  pipelineConfig,
  selectedStepId,
  selectedStep,
  viewMode,
  focusedPanel,
  panelRefs,
  onFocusPanel,
  onAddStep,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onAddBranch,
  onRemoveBranch,
  onAddChild,
  onRemoveChild,
  onUpdateStep,
  datasetBinding,
}: PipelineEditorWorkspaceProps) {
  return (
    <PipelineEditorPreferencesProvider>
      <NodeRegistryProvider>
        <OperatorAvailabilityProvider steps={steps} pipelineName={pipelineName}>
          <DatasetBindingProvider
            steps={steps}
            boundDataset={datasetBinding.boundDataset}
            datasets={datasetBinding.datasets}
            isLoading={datasetBinding.isLoading}
            onBind={datasetBinding.bindDataset}
            onClear={datasetBinding.clearBinding}
            onSelectTarget={datasetBinding.selectTarget}
            onRefresh={datasetBinding.refreshDatasets}
          >
            <div className="flex-1 flex z-0 min-h-0">
              <div
                ref={panelRefs.palette}
                className="w-72 flex-shrink-0 relative z-10 overflow-hidden"
                onClick={() => onFocusPanel("palette")}
              >
                <FocusPanelRing isFocused={focusedPanel === "palette"} color="blue" />
                <StepPalette onAddStep={onAddStep} />
              </div>

              <div
                ref={panelRefs.tree}
                className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden"
                onClick={() => onFocusPanel("tree")}
              >
                <FocusPanelRing isFocused={focusedPanel === "tree"} color="emerald" />
                {viewMode === "code" ? (
                  <PipelineYAMLView
                    steps={steps}
                    pipelineName={pipelineName}
                    randomState={pipelineConfig.seed}
                    className="h-full"
                  />
                ) : (
                  <PipelineTree
                    steps={steps}
                    selectedStepId={selectedStepId}
                    onSelectStep={onSelectStep}
                    onRemoveStep={onRemoveStep}
                    onDuplicateStep={onDuplicateStep}
                    onAddBranch={onAddBranch}
                    onRemoveBranch={onRemoveBranch}
                    onAddChild={onAddChild}
                    onRemoveChild={onRemoveChild}
                  />
                )}
              </div>

              <div
                ref={panelRefs.config}
                className="w-80 flex-shrink-0 border-l border-border relative overflow-hidden"
                onClick={() => onFocusPanel("config")}
              >
                <FocusPanelRing isFocused={focusedPanel === "config"} color="purple" />
                <StepConfigPanel
                  step={selectedStep}
                  onUpdate={onUpdateStep}
                  onRemove={onRemoveStep}
                  onDuplicate={onDuplicateStep}
                  onSelectStep={onSelectStep}
                  onAddChild={onAddChild}
                  onRemoveChild={onRemoveChild}
                />
              </div>
            </div>
          </DatasetBindingProvider>
        </OperatorAvailabilityProvider>
      </NodeRegistryProvider>
    </PipelineEditorPreferencesProvider>
  );
}
