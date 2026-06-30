import type { Dispatch, SetStateAction } from "react";
import { motion } from "@/lib/motion";
import {
  Activity,
  BarChart3,
  Cpu,
  GitBranch,
  Layers,
  Loader2,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  GenerateSyntheticRequest,
  SyntheticPreset,
} from "@/types/settings";

const presetIcons: Record<string, LucideIcon> = {
  activity: Activity,
  "trending-up": TrendingUp,
  "bar-chart-3": BarChart3,
  "git-branch": GitBranch,
  layers: Layers,
  cpu: Cpu,
};

function PresetIcon({ icon }: { icon: string }) {
  const IconComponent = presetIcons[icon] ?? Activity;
  return <IconComponent className="h-4 w-4" />;
}

interface SyntheticPresetTabProps {
  config: GenerateSyntheticRequest;
  isLoadingPresets: boolean;
  onPresetClick: (preset: SyntheticPreset) => void;
  presets: SyntheticPreset[];
  selectedPreset: string | null;
  setConfig: Dispatch<SetStateAction<GenerateSyntheticRequest>>;
}

export function SyntheticPresetTab({
  config,
  isLoadingPresets,
  onPresetClick,
  presets,
  selectedPreset,
  setConfig,
}: SyntheticPresetTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select a preset configuration for quick dataset generation.
      </p>

      {isLoadingPresets ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {presets.map((preset) => (
            <Card
              key={preset.id}
              className={`cursor-pointer transition-all hover:border-primary/50 ${
                selectedPreset === preset.id ? "border-primary bg-primary/5" : ""
              }`}
              onClick={() => onPresetClick(preset)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      selectedPreset === preset.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <PresetIcon icon={preset.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm">{preset.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {preset.n_samples} samples
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {preset.complexity}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedPreset && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-4 pt-4 border-t"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Dataset Name (optional)</Label>
              <Input
                placeholder="Auto-generated if empty"
                value={config.name ?? ""}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    name: event.target.value || undefined,
                  }))
                }
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-link-preset"
                  checked={config.auto_link ?? true}
                  onCheckedChange={(value) =>
                    setConfig((prev) => ({ ...prev, auto_link: value }))
                  }
                />
                <Label htmlFor="auto-link-preset" className="text-xs">
                  Auto-link to workspace
                </Label>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
