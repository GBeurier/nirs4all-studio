import {
  SelectGroup,
  SelectItem,
  SelectLabel,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Layers,
  GitBranch,
  SplitSquareHorizontal,
  Brain,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SourceOption } from './sourceDatasetOptions';
import type { SourceOptionGroup } from './SourceDatasetSelectorGroups';

interface SourceOptionIconProps {
  type: SourceOption['type'];
  className?: string;
}

export function SourceOptionIcon({ type, className }: SourceOptionIconProps) {
  const iconClass = cn('w-3.5 h-3.5', className);

  switch (type) {
    case 'original':
      return <Database className={iconClass} />;
    case 'preprocessor':
      return <Layers className={iconClass} />;
    case 'splitter':
      return <SplitSquareHorizontal className={iconClass} />;
    case 'model':
      return <Brain className={iconClass} />;
    case 'branch':
      return <GitBranch className={iconClass} />;
    default:
      return <Layers className={iconClass} />;
  }
}

function SourceOptionItem({
  option,
  truncateLabel,
}: {
  option: SourceOption;
  truncateLabel: boolean;
}) {
  return (
    <SelectItem
      value={option.id}
      disabled={!option.available}
    >
      <span className="flex items-center gap-2">
        <SourceOptionIcon type={option.type} />
        <span className={cn('flex-1', truncateLabel && 'truncate')}>
          {option.label}
        </span>
        <Badge variant="outline" className="text-[9px] px-1 h-4">
          {option.position}
        </Badge>
      </span>
    </SelectItem>
  );
}

export function SourceOptionGroups({ groups }: { groups: SourceOptionGroup[] }) {
  return (
    <>
      {groups.map(group => (
        <SelectGroup key={group.id}>
          <SelectLabel className="text-[10px] text-muted-foreground">
            {group.label}
          </SelectLabel>
          {group.options.map(option => (
            <SourceOptionItem
              key={option.id}
              option={option}
              truncateLabel={group.id !== 'input'}
            />
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
