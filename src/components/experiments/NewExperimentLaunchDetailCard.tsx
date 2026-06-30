import type { ReactNode } from "react";

export interface NewExperimentLaunchDetailField {
  id: string;
  label: string;
  value: string;
  title?: string;
}

export interface NewExperimentLaunchDetailCardProps {
  children?: ReactNode;
  fields: readonly NewExperimentLaunchDetailField[];
  title?: string;
}

export function NewExperimentLaunchDetailCard({
  children,
  fields,
  title,
}: NewExperimentLaunchDetailCardProps) {
  const fieldListMarginClass = children ? "mt-3" : title ? "mt-2" : "";

  return (
    <div className="mx-auto mt-3 max-w-md rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      {title && <p className="text-xs font-medium text-foreground">{title}</p>}
      {children}
      <div className={`${fieldListMarginClass} space-y-1 text-left`}>
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{field.label}</span>
            <span
              className="truncate text-right font-medium text-foreground"
              title={field.title ?? field.value}
            >
              {field.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
