import { RefreshCw } from "lucide-react";
import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PythonEnvPickerHeaderProps {
  title: string;
  description: string;
  refreshLabel: string;
  isRefreshing: boolean;
  isSettingUp: boolean;
  onRefresh: () => void;
}

export function PythonEnvPickerHeader({
  title,
  description,
  refreshLabel,
  isRefreshing,
  isSettingUp,
  onRefresh,
}: PythonEnvPickerHeaderProps) {
  return (
    <CardHeader>
      <div className="flex items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3" />
              <path d="M12 15h7a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3" />
              <path d="M8 9V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2Z" />
              <circle cx="7.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
              <circle cx="16.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing || isSettingUp}
          title={refreshLabel}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </CardHeader>
  );
}
