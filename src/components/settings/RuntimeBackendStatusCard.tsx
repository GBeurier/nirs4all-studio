import { Cpu } from "lucide-react";

import { RuntimeBackendStatus } from "@/components/runtime/RuntimeBackendStatus";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function RuntimeBackendStatusCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Analysis Engine
        </CardTitle>
        <CardDescription>
          Studio uses this engine to run experiments and pipelines.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeBackendStatus />
      </CardContent>
    </Card>
  );
}
