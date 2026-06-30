import { ChevronDown, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface FoldDistributionSettingsMenuProps {
  showLegend: boolean;
  showYLegend: boolean;
  showMeanLine: boolean;
  disableYLegend: boolean;
  disableMeanLine: boolean;
  onShowLegendChange: (checked: boolean) => void;
  onShowYLegendChange: (checked: boolean) => void;
  onShowMeanLineChange: (checked: boolean) => void;
}

export function FoldDistributionSettingsMenu({
  showLegend,
  showYLegend,
  showMeanLine,
  disableYLegend,
  disableMeanLine,
  onShowLegendChange,
  onShowYLegendChange,
  onShowMeanLineChange,
}: FoldDistributionSettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Display Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={showLegend}
          onCheckedChange={(checked) => onShowLegendChange(checked === true)}
        >
          Show Color Legend
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={showYLegend}
          onCheckedChange={(checked) => onShowYLegendChange(checked === true)}
          disabled={disableYLegend}
        >
          Show Y Value Legend
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={showMeanLine}
          onCheckedChange={(checked) => onShowMeanLineChange(checked === true)}
          disabled={disableMeanLine}
        >
          Show Global Mean (Y Dist.)
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
