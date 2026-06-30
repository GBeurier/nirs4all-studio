import { AlertCircle } from "lucide-react";

interface ResultMetricsErrorStateProps {
  message: string;
}

export function ResultMetricsErrorState({ message }: ResultMetricsErrorStateProps) {
  return (
    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
      <h4 className="font-medium text-sm text-destructive mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Error
      </h4>
      <p className="text-sm text-destructive/80">{message}</p>
    </div>
  );
}
