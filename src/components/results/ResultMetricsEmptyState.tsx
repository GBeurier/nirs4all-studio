import { BarChart3 } from "lucide-react";

interface ResultMetricsEmptyStateProps {
  message: string;
}

export function ResultMetricsEmptyState({ message }: ResultMetricsEmptyStateProps) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
