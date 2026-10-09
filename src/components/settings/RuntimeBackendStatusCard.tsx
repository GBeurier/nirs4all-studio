import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RuntimeBackendStatus } from "@/components/runtime/RuntimeBackendStatus";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function RuntimeBackendStatusCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          {t("settings.runtimeBackend.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.runtimeBackend.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeBackendStatus />
      </CardContent>
    </Card>
  );
}
