import { Cpu } from "lucide-react";

import { RuntimeBackendSelector } from "@/components/runtime/RuntimeBackendSelector";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRuntimeBackendPreference } from "@/lib/runtimeBackendPreference";

export function RuntimeBackendPreference() {
  const {
    runtimeEngine,
    allowFallback,
    setRuntimeEngine,
    setAllowFallback,
  } = useRuntimeBackendPreference();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Runtime Backend
        </CardTitle>
        <CardDescription>
          Default backend for new experiments and direct pipeline runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeBackendSelector
          runtimeEngine={runtimeEngine}
          allowFallback={allowFallback}
          onRuntimeEngineChange={setRuntimeEngine}
          onAllowFallbackChange={setAllowFallback}
        />
      </CardContent>
    </Card>
  );
}
