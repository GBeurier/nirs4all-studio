import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  Info,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Sliders,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { PipelineStep } from "../../types";
import type { ParameterRendererProps } from "./types";
import {
  MODEL_TAB_TRIGGER_CLASS_NAME,
  type ModelRendererViewState,
} from "./ModelRendererData";
import { loadFinetuneTab, preloadFinetuneTab } from "./finetuneTabLoader";
import { ModelRefitTab } from "./ModelRendererRefitTab";
import { ModelTrainingTab } from "./ModelRendererTrainingTab";

const FinetuneTab = lazy(() =>
  loadFinetuneTab().then((m) => ({ default: m.FinetuneTab }))
);

type RenderParamInput = ParameterRendererProps["renderParamInput"];
type ModelStepUpdate = (updates: Partial<PipelineStep>) => void;

interface ModelConfigTabsProps {
  activeTab: string;
  onActiveTabChange: (value: string) => void;
  step: PipelineStep;
  viewState: ModelRendererViewState;
  renderParamInput: RenderParamInput;
  onResetParams: () => void;
  onConfigureFinetuning: () => void;
  onUpdateStep: ModelStepUpdate;
}

export function ModelConfigTabs({
  activeTab,
  onActiveTabChange,
  step,
  viewState,
  renderParamInput,
  onResetParams,
  onConfigureFinetuning,
  onUpdateStep,
}: ModelConfigTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onActiveTabChange}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <ModelTabsHeader viewState={viewState} />

      <ModelParametersTab
        step={step}
        viewState={viewState}
        renderParamInput={renderParamInput}
        onResetParams={onResetParams}
        onConfigureFinetuning={onConfigureFinetuning}
      />

      <TabsContent value="finetuning" className="flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <Suspense fallback={<FinetuneTabSkeleton />}>
            <FinetuneTab step={step} onUpdate={onUpdateStep} />
          </Suspense>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="refit" className="flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <ModelRefitTab step={step} onUpdate={onUpdateStep} />
        </ScrollArea>
      </TabsContent>

      {viewState.isDeepLearning && (
        <TabsContent value="training" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <ModelTrainingTab step={step} onUpdate={onUpdateStep} />
          </ScrollArea>
        </TabsContent>
      )}
    </Tabs>
  );
}

interface ModelTabsHeaderProps {
  viewState: ModelRendererViewState;
}

function ModelTabsHeader({ viewState }: ModelTabsHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border px-2">
      <TabsList className="h-10 w-full justify-start bg-transparent gap-1">
        <TabsTrigger
          value="parameters"
          className={MODEL_TAB_TRIGGER_CLASS_NAME}
        >
          <Sliders className="h-3.5 w-3.5 mr-1.5" />
          {t("pipelineEditor.config.model.tabParameters")}
        </TabsTrigger>
        <TabsTrigger
          value="finetuning"
          className={viewState.finetuningTabClassName}
          onMouseEnter={preloadFinetuneTab}
          onFocus={preloadFinetuneTab}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          {t("pipelineEditor.config.model.tabFinetuning")}
          {viewState.hasFinetuning && (
            <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-purple-500">
              {viewState.finetuningTrialBadgeLabel}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="refit"
          className={viewState.refitTabClassName}
        >
          <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
          {t("pipelineEditor.config.model.tabRefit")}
          {viewState.hasRefit && (
            <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-emerald-500">
              {t("pipelineEditor.config.model.refitOn")}
            </Badge>
          )}
        </TabsTrigger>
        {viewState.isDeepLearning && (
          <TabsTrigger
            value="training"
            className={MODEL_TAB_TRIGGER_CLASS_NAME}
          >
            <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
            {t("pipelineEditor.config.model.tabTraining")}
          </TabsTrigger>
        )}
      </TabsList>
    </div>
  );
}

interface ModelParametersTabProps {
  step: PipelineStep;
  viewState: ModelRendererViewState;
  renderParamInput: RenderParamInput;
  onResetParams: () => void;
  onConfigureFinetuning: () => void;
}

function ModelParametersTab({
  step,
  viewState,
  renderParamInput,
  onResetParams,
  onConfigureFinetuning,
}: ModelParametersTabProps) {
  const { t } = useTranslation();
  return (
    <TabsContent value="parameters" className="flex-1 overflow-hidden mt-0">
      <ScrollArea className="h-full">
        <div className="p-4 space-y-6">
          {viewState.hasParameters ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("pipelineEditor.config.model.parameters")}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onResetParams}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {t("pipelineEditor.config.model.reset")}
                </Button>
              </div>
              {Object.entries(step.params).map(([key, value]) =>
                renderParamInput(key, value)
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="p-3 rounded-full bg-muted/50 w-fit mx-auto mb-3">
                <Info className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("pipelineEditor.config.model.noParams")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pipelineEditor.config.model.usesDefaults")}
              </p>
            </div>
          )}

          {viewState.showQuickFinetuningCta && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-foreground">
                  {t("pipelineEditor.config.model.optimizeCta")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("pipelineEditor.config.model.optimizeCtaHint")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-purple-500/50 text-purple-500 hover:bg-purple-500/10"
                onClick={onConfigureFinetuning}
                onMouseEnter={preloadFinetuneTab}
              >
                {t("pipelineEditor.config.model.configure")}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </TabsContent>
  );
}

function FinetuneTabSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        <span className="ml-2 text-sm text-muted-foreground">{t("pipelineEditor.config.model.loadingFinetuning")}</span>
      </div>
    </div>
  );
}
