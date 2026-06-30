/**
 * Advanced loading options accordion.
 *
 * Pure presentation: optional encoding / skip-rows / Excel sheet-name controls
 * collapsed inside the global settings card. Edits are reported through the
 * `onChange` callback; the parent owns wizard dispatch.
 */
import { SlidersHorizontal } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ENCODING_OPTIONS } from "./ParsingStepConstants";
import type { ParsingOptions } from "@/types/datasets";

export interface AdvancedLoadingOptionsProps {
  parsing: Partial<ParsingOptions>;
  onChange: (updates: Partial<ParsingOptions>) => void;
}

export function AdvancedLoadingOptions({ parsing, onChange }: AdvancedLoadingOptionsProps) {
  return (
    <Accordion type="single" collapsible className="mt-4">
      <AccordionItem value="advanced-loading" className="border-none">
        <AccordionTrigger className="py-2 hover:no-underline">
          <div className="flex items-center gap-2 text-sm">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <span>Advanced Loading Options</span>
            <Badge variant="outline" className="ml-2 text-xs font-normal">
              Optional
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-3 gap-4 pt-2">
            {/* Encoding */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                File Encoding
              </Label>
              <Select
                value={parsing.encoding || "utf-8"}
                onValueChange={(v) => onChange({ encoding: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENCODING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Skip Rows */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Skip Rows at Start
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={parsing.skip_rows || 0}
                onChange={(e) => onChange({ skip_rows: parseInt(e.target.value) || 0 })}
                className="h-9"
              />
            </div>

            {/* Sheet Name (for Excel files) */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Sheet Name (Excel)
              </Label>
              <Input
                type="text"
                placeholder="First sheet (default)"
                value={parsing.sheet_name || ""}
                onChange={(e) => onChange({ sheet_name: e.target.value || undefined })}
                className="h-9"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
