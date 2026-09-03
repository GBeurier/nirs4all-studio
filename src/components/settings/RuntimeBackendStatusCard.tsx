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
          Runtime Backend
        </CardTitle>
        <CardDescription>
          Studio runs experiments and direct pipelines with the strict native backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeBackendStatus />
      </CardContent>
    </Card>
  );
}
