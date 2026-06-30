import { AlertCircle, ChevronDown, HardDrive } from "lucide-react";

import type { RuntimeInfo } from "@/api/updates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";

import type { TextDisplay } from "./UpdatesSectionLogic";

type RuntimeStatusPanelProps = {
  currentRuntime: RuntimeInfo | null;
  gpuDisplay: TextDisplay;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  packageCount: number;
  runtimeDisplay: Pick<PythonRuntimeDisplayState, "label">;
  runtimeExecutablePath: string;
  runtimeSizeLabel: string;
  torchDisplay: TextDisplay | null;
};

function RuntimeTextValue({ value }: { value: TextDisplay }) {
  if (value.muted) {
    return <span className="text-muted-foreground">{value.label}</span>;
  }

  return value.label;
}

export function RuntimeStatusPanel({
  currentRuntime,
  gpuDisplay,
  isLoading,
  onOpenChange,
  open,
  packageCount,
  runtimeDisplay,
  runtimeExecutablePath,
  runtimeSizeLabel,
  torchDisplay,
}: RuntimeStatusPanelProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Current Python Runtime
          </span>
          <div className="flex items-center gap-2">
            {currentRuntime?.is_valid ? (
              <Badge variant="outline" className="text-green-600">Ready</Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600">Unavailable</Badge>
            )}
            <Badge variant="secondary" className="text-xs">{runtimeDisplay.label}</Badge>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : currentRuntime?.is_valid ? (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Python:</span>
              <span className="font-mono">{currentRuntime.python_version}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">Runtime:</span>
              <span className="text-right max-w-[60%]">{runtimeDisplay.label}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">Python executable:</span>
              <span className="font-mono text-xs break-all text-right max-w-[60%]">
                {runtimeExecutablePath}
              </span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">Detected GPU:</span>
              <span className="text-right max-w-[60%]">
                <RuntimeTextValue value={gpuDisplay} />
              </span>
            </div>
            {torchDisplay && (
              <div className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground">Torch runtime:</span>
                <span className="text-right max-w-[60%]">
                  <RuntimeTextValue value={torchDisplay} />
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Size:</span>
              <span>{runtimeSizeLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Packages:</span>
              <span>{packageCount} installed</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Environment root:</span>
              <span className="font-mono text-xs break-all text-right max-w-[60%]">
                {currentRuntime.path}
              </span>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The current Python runtime is not valid. Use the Python Runtime section above to select or create a runtime before installing packages or restoring snapshots.
            </AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
