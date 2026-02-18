/**
 * ConfigurationPanel - Right panel for synthesis configuration
 *
 * Unified panel combining:
 * - Core configuration (collapsible)
 * - Steps list with inline configuration (accordion-style)
 * - Export button
 */

import { useState } from "react";
import { FileOutput, AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSynthesisBuilder } from "../contexts";
import { CoreConfigSection } from "./CoreConfigSection";
import { StepsList } from "./StepsList";
import { ExportDialog } from "../ExportDialog";
import { cn } from "@/lib/utils";

interface ConfigurationPanelProps {
  className?: string;
}

export function ConfigurationPanel({ className }: ConfigurationPanelProps) {
  const { state } = useSynthesisBuilder();
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { errors, warnings } = state;
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <div className={cn("h-full flex flex-col overflow-hidden border-l", className)}>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {/* Validation alerts */}
          {hasErrors && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {errors.map((e, i) => (
                  <div key={i}>{e.message}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {hasWarnings && (
            <Alert className="py-2 border-yellow-500/50 bg-yellow-500/10">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-xs text-yellow-700 dark:text-yellow-400">
                {warnings.map((w, i) => (
                  <div key={i}>{w.message}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* Core configuration */}
          <CoreConfigSection />

          <Separator />

          {/* Steps list with inline config */}
          <StepsList />
        </div>
      </ScrollArea>

      {/* Export button at bottom */}
      <div className="shrink-0 p-3 border-t">
        <Button
          className="w-full bg-teal-600 hover:bg-teal-700"
          onClick={() => setShowExportDialog(true)}
          disabled={hasErrors || state.steps.filter((s) => s.enabled).length === 0}
        >
          <FileOutput className="h-4 w-4 mr-2" />
          Export Dataset
        </Button>
      </div>

      {/* Export dialog */}
      <ExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
      />
    </div>
  );
}
