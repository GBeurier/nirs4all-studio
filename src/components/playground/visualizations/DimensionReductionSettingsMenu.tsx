import { ChevronDown, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type DimensionReductionPointSize = 'small' | 'medium' | 'large';
export type DimensionReductionColorMode = 'target' | 'fold' | 'metadata';

export interface DimensionReductionSettingsMenuProps {
  pointSize: DimensionReductionPointSize;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  showEqualAxisScale: boolean;
  showLegacyColorOptions: boolean;
  hasFolds: boolean;
  metadataKeys: string[];
  onPointSizeChange: (pointSize: DimensionReductionPointSize) => void;
  onShowGridChange: (checked: boolean) => void;
  onPreserveAspectRatioChange: (checked: boolean) => void;
  onColorModeChange: (colorMode: DimensionReductionColorMode) => void;
  onMetadataKeyChange: (metadataKey: string) => void;
}

export function DimensionReductionSettingsMenu({
  pointSize,
  showGrid,
  preserveAspectRatio,
  colorMode,
  metadataKey,
  showEqualAxisScale,
  showLegacyColorOptions,
  hasFolds,
  metadataKeys,
  onPointSizeChange,
  onShowGridChange,
  onPreserveAspectRatioChange,
  onColorModeChange,
  onMetadataKeyChange,
}: DimensionReductionSettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Point Size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pointSize}
          onValueChange={(value) => onPointSizeChange(value as DimensionReductionPointSize)}
        >
          <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={showGrid}
          onCheckedChange={(checked) => onShowGridChange(checked === true)}
        >
          Show Grid
        </DropdownMenuCheckboxItem>

        {showEqualAxisScale && (
          <DropdownMenuCheckboxItem
            checked={preserveAspectRatio}
            onCheckedChange={(checked) => onPreserveAspectRatioChange(checked === true)}
          >
            Equal Axis Scale
          </DropdownMenuCheckboxItem>
        )}

        {showLegacyColorOptions && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Color By</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={colorMode}
              onValueChange={(value) => onColorModeChange(value as DimensionReductionColorMode)}
            >
              <DropdownMenuRadioItem value="target">Y Value</DropdownMenuRadioItem>
              {hasFolds && (
                <DropdownMenuRadioItem value="fold">Fold</DropdownMenuRadioItem>
              )}
              {metadataKeys.length > 0 && (
                <DropdownMenuRadioItem value="metadata">Metadata</DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>

            {colorMode === 'metadata' && metadataKeys.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Field</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={metadataKey || metadataKeys[0]}
                  onValueChange={onMetadataKeyChange}
                >
                  {metadataKeys.slice(0, 10).map(key => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {key}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
