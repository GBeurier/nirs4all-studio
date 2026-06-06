import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";

// Status -> lucide icon map shared by StatusBadge and PipelineProgress.
export const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  partial: AlertCircle,
};
