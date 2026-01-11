/**
 * CoreConfigCard - Core synthesis configuration
 *
 * Displays and edits the base builder parameters:
 * - name
 * - n_samples
 * - random_state
 */

import { useState } from "react";
import { Dices, Hash, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSynthesisBuilder } from "./contexts";
import { cn } from "@/lib/utils";

interface CoreConfigCardProps {
  className?: string;
}

export function CoreConfigCard({ className }: CoreConfigCardProps) {
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
    <Card className={cn("border-primary/30 bg-primary/5", className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">SyntheticDatasetBuilder</h3>
            <p className="text-xs text-muted-foreground">Core configuration</p>
          </div>
        </div>

        <div className="grid gap-3">
          {/* Name */}
          <div className="grid gap-1.5">
            <Label htmlFor="synthesis-name" className="text-xs">
              Dataset Name
            </Label>
            <Input
              id="synthesis-name"
              value={state.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="synthetic_nirs"
              className="h-8 text-sm"
            />
          </div>

          {/* n_samples */}
          <div className="grid gap-1.5">
            <Label htmlFor="n-samples" className="text-xs flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Number of Samples
            </Label>
            <Input
              id="n-samples"
              type="number"
              value={localSamples}
              onChange={(e) => handleSamplesChange(e.target.value)}
              onBlur={handleSamplesBlur}
              min={10}
              max={100000}
              className="h-8 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Range: 10 - 100,000 samples
            </p>
          </div>

          {/* random_state */}
          <div className="grid gap-1.5">
            <Label htmlFor="random-state" className="text-xs flex items-center gap-1">
              <Dices className="h-3 w-3" />
              Random State
            </Label>
            <div className="flex gap-2">
              <Input
                id="random-state"
                type="number"
                value={state.random_state ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setRandomState(val === "" ? null : parseInt(val, 10));
                }}
                placeholder="None (random)"
                className="h-8 text-sm flex-1"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={generateRandomSeed}
                  >
                    <Dices className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Generate random seed</TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              Set a seed for reproducible results
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
