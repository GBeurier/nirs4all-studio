interface InspectorSidebarEmptyStateProps {
  title: string;
  description: string;
}

export function InspectorSidebarEmptyState({
  title,
  description,
}: InspectorSidebarEmptyStateProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs">
        {description}
      </div>
    </div>
  );
}
