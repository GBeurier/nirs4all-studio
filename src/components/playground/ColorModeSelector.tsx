import { ColorConfig, ColorMode, ProcessedData } from '@/types/spectral';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Palette } from 'lucide-react';
import { getMetadataKeys, getDatasetSources } from '@/lib/colorUtils';

interface ColorModeSelectorProps {
  colorConfig: ColorConfig;
  onChange: (config: ColorConfig) => void;
  data: ProcessedData;
}

export function ColorModeSelector({ colorConfig, onChange, data }: ColorModeSelectorProps) {
  const metadataKeys = getMetadataKeys(data);
  const hasDatasets = getDatasetSources(data).length > 1;

  return (
    <div className="flex items-center gap-1.5">
      <Palette className="w-3 h-3 text-muted-foreground" />
      <Select
        value={colorConfig.mode}
        onValueChange={(v) => onChange({ mode: v as ColorMode, metadataKey: colorConfig.metadataKey })}
      >
        <SelectTrigger className="h-6 w-20 text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="target">Target</SelectItem>
          {hasDatasets && <SelectItem value="dataset">Dataset</SelectItem>}
          {metadataKeys.length > 0 && <SelectItem value="metadata">Metadata</SelectItem>}
        </SelectContent>
      </Select>
      {colorConfig.mode === 'metadata' && metadataKeys.length > 0 && (
        <Select
          value={colorConfig.metadataKey || metadataKeys[0]}
          onValueChange={(v) => onChange({ ...colorConfig, metadataKey: v })}
        >
          <SelectTrigger className="h-6 w-24 text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {metadataKeys.map(key => (
              <SelectItem key={key} value={key}>{key}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
