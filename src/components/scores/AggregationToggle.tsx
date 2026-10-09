import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Layers, List } from "lucide-react";
import { useTranslation } from "react-i18next";

export type AggregationMode = "aggregated" | "per-fold";

interface AggregationToggleProps {
  value: AggregationMode;
  onChange: (value: AggregationMode) => void;
}

export function AggregationToggle({ value, onChange }: AggregationToggleProps) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => { if (v) onChange(v as AggregationMode); }}
      className="border rounded-md p-0.5"
    >
      <ToggleGroupItem value="aggregated" className="h-7 px-2.5 text-xs gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
        <Layers className="h-3.5 w-3.5" />
        {t("results.scores.aggregation.aggregated")}
      </ToggleGroupItem>
      <ToggleGroupItem value="per-fold" className="h-7 px-2.5 text-xs gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
        <List className="h-3.5 w-3.5" />
        {t("results.scores.aggregation.perFold")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
