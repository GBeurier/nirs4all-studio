/**
 * FeaturesConfig - Configuration panel for with_features() step
 */

import { useState, useMemo } from "react";
import { Waves, X, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CHEMICAL_COMPONENTS } from "../definitions";
import type { SynthesisStepDefinition, Complexity } from "../types";
import { cn } from "@/lib/utils";

interface FeaturesConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function FeaturesConfig({
  params,
  definition,
  onChange,
}: FeaturesConfigProps) {
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);

  const wavelengthRange = (params.wavelength_range as [number, number]) || [1000, 2500];
  const wavelengthStep = (params.wavelength_step as number) || 2.0;
  const complexity = (params.complexity as Complexity) || "simple";
  const components = (params.components as string[]) || ["water", "protein", "lipid"];

  const numWavelengths = useMemo(() => {
    return Math.floor((wavelengthRange[1] - wavelengthRange[0]) / wavelengthStep) + 1;
  }, [wavelengthRange, wavelengthStep]);

  const handleWavelengthRangeChange = (values: number[]) => {
    onChange({ wavelength_range: [values[0], values[1]] });
  };

  const handleComponentToggle = (componentName: string) => {
    const newComponents = components.includes(componentName)
      ? components.filter((c) => c !== componentName)
      : [...components, componentName];
    onChange({ components: newComponents });
  };

  const handleRemoveComponent = (componentName: string) => {
    onChange({ components: components.filter((c) => c !== componentName) });
  };

  // Group components by category
  const componentsByCategory = useMemo(() => {
    const groups: Record<string, typeof CHEMICAL_COMPONENTS> = {};
    for (const comp of CHEMICAL_COMPONENTS) {
      if (!groups[comp.category]) {
        groups[comp.category] = [];
      }
      groups[comp.category].push(comp);
    }
    return groups;
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10">
          <Waves className="h-4 w-4 text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Features Configuration</h3>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </div>
      </div>

      <Separator />

      {/* Wavelength Range */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Wavelength Range</Label>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Slider
              value={wavelengthRange}
              min={350}
              max={3000}
              step={10}
              onValueChange={handleWavelengthRangeChange}
              className="w-full"
            />
          </div>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{wavelengthRange[0]} nm</span>
          <span>{wavelengthRange[1]} nm</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Start (nm)</Label>
            <Input
              type="number"
              value={wavelengthRange[0]}
              onChange={(e) =>
                handleWavelengthRangeChange([
                  parseInt(e.target.value) || 350,
                  wavelengthRange[1],
                ])
              }
              min={350}
              max={wavelengthRange[1] - 10}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">End (nm)</Label>
            <Input
              type="number"
              value={wavelengthRange[1]}
              onChange={(e) =>
                handleWavelengthRangeChange([
                  wavelengthRange[0],
                  parseInt(e.target.value) || 3000,
                ])
              }
              min={wavelengthRange[0] + 10}
              max={3000}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Wavelength Step */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Wavelength Step</Label>
          <span className="text-xs text-muted-foreground">
            {numWavelengths} wavelengths
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            value={[wavelengthStep]}
            min={0.5}
            max={10}
            step={0.5}
            onValueChange={(v) => onChange({ wavelength_step: v[0] })}
            className="flex-1"
          />
          <span className="w-16 text-right text-sm">{wavelengthStep} nm</span>
        </div>
      </div>

      {/* Complexity */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Complexity</Label>
        <Select
          value={complexity}
          onValueChange={(v) => onChange({ complexity: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simple">
              <div className="flex flex-col">
                <span>Simple</span>
                <span className="text-xs text-muted-foreground">
                  Minimal noise, fast generation
                </span>
              </div>
            </SelectItem>
            <SelectItem value="realistic">
              <div className="flex flex-col">
                <span>Realistic</span>
                <span className="text-xs text-muted-foreground">
                  Typical NIR noise and scatter
                </span>
              </div>
            </SelectItem>
            <SelectItem value="complex">
              <div className="flex flex-col">
                <span>Complex</span>
                <span className="text-xs text-muted-foreground">
                  High noise, artifacts, challenging
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Components */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Chemical Components</Label>
          <Badge variant="secondary">{components.length} selected</Badge>
        </div>

        {/* Selected components */}
        <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 border rounded-md bg-muted/30">
          {components.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No components selected
            </span>
          ) : (
            components.map((name) => {
              const comp = CHEMICAL_COMPONENTS.find((c) => c.name === name);
              return (
                <Badge
                  key={name}
                  variant="secondary"
                  className="gap-1 pr-1"
                >
                  {comp?.displayName || name}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0 hover:bg-destructive/20"
                    onClick={() => handleRemoveComponent(name)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              );
            })
          )}
        </div>

        {/* Component selector */}
        <Popover open={componentSearchOpen} onOpenChange={setComponentSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-start">
              <span className="text-muted-foreground">Add components...</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search components..." />
              <CommandList>
                <CommandEmpty>No components found.</CommandEmpty>
                <ScrollArea className="h-[300px]">
                  {Object.entries(componentsByCategory).map(([category, comps]) => (
                    <CommandGroup key={category} heading={category.charAt(0).toUpperCase() + category.slice(1)}>
                      {comps.map((comp) => {
                        const isSelected = components.includes(comp.name);
                        return (
                          <CommandItem
                            key={comp.name}
                            value={comp.name}
                            onSelect={() => handleComponentToggle(comp.name)}
                          >
                            <div
                              className={cn(
                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                                isSelected
                                  ? "bg-primary border-primary"
                                  : "border-muted-foreground"
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                            <div className="flex-1">
                              <span>{comp.displayName}</span>
                              <p className="text-xs text-muted-foreground">
                                {comp.description}
                              </p>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </ScrollArea>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
