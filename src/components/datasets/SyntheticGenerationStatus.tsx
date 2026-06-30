import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AnimatePresence, motion } from "@/lib/motion";
import { getGenerationErrorMessage } from "./SyntheticDataDialogData";

interface SyntheticGenerationStatusProps {
  data?: { name?: string | null } | null;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
}

export function SyntheticGenerationStatus({
  data,
  error,
  isError,
  isSuccess,
}: SyntheticGenerationStatusProps) {
  return (
    <AnimatePresence mode="wait">
      {isSuccess && data && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400"
        >
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">
              Dataset generated successfully!
            </p>
            <p className="text-xs truncate">{data.name}</p>
          </div>
        </motion.div>
      )}
      {isError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Generation failed</p>
            <p className="text-xs">{getGenerationErrorMessage(error)}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
