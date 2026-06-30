/**
 * Synthetic Data Generation Dialog
 *
 * A dialog component for generating synthetic NIRS datasets.
 * Provides both quick presets and detailed configuration options.
 *
 * Phase 4 Implementation - Developer Mode Feature
 */

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  generateSyntheticDataset,
  getSyntheticPresets,
} from "@/api/datasets";
import type {
  GenerateSyntheticRequest,
  SyntheticPreset,
} from "@/types/settings";
import {
  applyPresetToConfig,
  createInitialSyntheticConfig,
  type SyntheticDialogTab,
} from "./SyntheticDataDialogData";
import { SyntheticCustomConfigTab } from "./SyntheticCustomConfigTab";
import { SyntheticDialogFooter } from "./SyntheticDialogFooter";
import { SyntheticGenerationStatus } from "./SyntheticGenerationStatus";
import { SyntheticPresetTab } from "./SyntheticPresetTab";

interface SyntheticDataDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onDatasetGenerated?: (datasetId: string | undefined) => void;
}

export function SyntheticDataDialog({
  open,
  onOpenChange,
  trigger,
  onDatasetGenerated,
}: SyntheticDataDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [activeTab, setActiveTab] = useState<SyntheticDialogTab>("presets");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState<GenerateSyntheticRequest>(
    createInitialSyntheticConfig,
  );

  const queryClient = useQueryClient();

  const { data: presetsData, isLoading: isLoadingPresets } = useQuery({
    queryKey: ["synthetic-presets"],
    queryFn: getSyntheticPresets,
    staleTime: 5 * 60 * 1000,
  });

  const presets = presetsData?.presets ?? [];

  const generateMutation = useMutation({
    mutationFn: generateSyntheticDataset,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      onDatasetGenerated?.(data.dataset_id ?? undefined);

      setTimeout(() => {
        setIsOpen(false);
        setSelectedPreset(null);
        setConfig(createInitialSyntheticConfig());
        setShowAdvanced(false);
        generateMutation.reset();
      }, 1500);
    },
  });

  const handlePresetClick = (preset: SyntheticPreset) => {
    setSelectedPreset(preset.id);
    setConfig((prev) => applyPresetToConfig(prev, preset));
  };

  const handleGenerate = () => {
    generateMutation.mutate(config);
  };

  const isGenerating = generateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Generate Synthetic Dataset
            <Badge variant="outline" className="ml-2">
              Dev Mode
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Create synthetic spectral data for testing and development purposes.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SyntheticDialogTab)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="presets">Quick Presets</TabsTrigger>
            <TabsTrigger value="custom">Custom Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="presets">
            <SyntheticPresetTab
              config={config}
              isLoadingPresets={isLoadingPresets}
              onPresetClick={handlePresetClick}
              presets={presets}
              selectedPreset={selectedPreset}
              setConfig={setConfig}
            />
          </TabsContent>

          <TabsContent value="custom">
            <SyntheticCustomConfigTab
              config={config}
              setConfig={setConfig}
              showAdvanced={showAdvanced}
              onShowAdvancedChange={setShowAdvanced}
            />
          </TabsContent>
        </Tabs>

        <SyntheticGenerationStatus
          data={generateMutation.data}
          error={generateMutation.error}
          isError={generateMutation.isError}
          isSuccess={generateMutation.isSuccess}
        />

        <SyntheticDialogFooter
          activeTab={activeTab}
          isGenerating={isGenerating}
          onCancel={() => setIsOpen(false)}
          onGenerate={handleGenerate}
          selectedPreset={selectedPreset}
        />
      </DialogContent>
    </Dialog>
  );
}

export default SyntheticDataDialog;
