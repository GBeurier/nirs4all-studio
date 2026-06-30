import type { ComponentType } from 'react';

interface ConfusionMatrixStateCardProps {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

export function ConfusionMatrixStateCard({
  title,
  description,
  icon: Icon,
}: ConfusionMatrixStateCardProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
