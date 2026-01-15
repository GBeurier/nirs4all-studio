/**
 * CoreConfigSection - Compact core synthesis configuration
 */

import { useState } from "react";
import { Dices } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSynthesisBuilder } from "../contexts";
import { cn } from "@/lib/utils";

interface CoreConfigSectionProps {
  className?: string;
}

export function CoreConfigSection({ className }: CoreConfigSectionProps) {
  const { state, setName, setSamples, setRandomState } = useSynthesisBuilder();
  const [localSamples, setLocalSamples] = useState(state.n_samples.toString());

  const handleSamplesChange = (value: string) => {
    setLocalSamples(value);
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 10 && n <= 100000) {
      setSamples(n);
    }
  };

  const handleSamplesBlur = () => {
    setLocalSamples(state.n_samples.toString());
  };

  const generateRandomSeed = () => {
    const seed = Math.floor(Math.random() * 100000);
    setRandomState(seed);
  };

  return (
    <div className={cn("rounded-lg border bg-muted/30 p-2 space-y-2", className)}>
      {/* Row 1: Name */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-14 shrink-0">Name</span>
        <Input
          value={state.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="synthetic_nirs"
          className="h-7 text-xs"
        />
      </div>

      {/* Row 2: Samples + Seed */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted-foreground w-14 shrink-0">Samples</span>
          <Input
            type="number"
            value={localSamples}
            onChange={(e) => handleSamplesChange(e.target.value)}
            onBlur={handleSamplesBlur}
            min={10}
            max={100000}
            className="h-7 text-xs w-24"
          />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted-foreground shrink-0">Seed</span>
          <Input
            type="number"
            value={state.random_state ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setRandomState(val === "" ? null : parseInt(val, 10));
            }}
            placeholder="—"
            className="h-7 text-xs w-20"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={generateRandomSeed}
              >
                <Dices className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Random seed</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
