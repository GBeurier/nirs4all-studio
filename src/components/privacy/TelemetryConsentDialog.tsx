import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { disableSentry, initSentry } from "@/lib/sentry";
import {
  getTelemetryConsentStatus,
  setTelemetryConsentStatus,
  type TelemetryConsentStatus,
} from "@/lib/telemetryConsent";

export function TelemetryConsentDialog() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TelemetryConsentStatus>("unset");
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getTelemetryConsentStatus()
      .then((currentStatus) => {
        if (cancelled) return;
        setStatus(currentStatus);
        if (currentStatus === "accepted") {
          initSentry();
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (nextStatus: Exclude<TelemetryConsentStatus, "unset">) => {
    setIsSaving(true);
    try {
      await setTelemetryConsentStatus(nextStatus);
      setStatus(nextStatus);
      if (nextStatus === "accepted") {
        initSentry();
      } else {
        void disableSentry();
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AlertDialog open={isLoaded && status === "unset"}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("telemetryConsent.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("telemetryConsent.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t("telemetryConsent.includes")}</p>
          <p>{t("telemetryConsent.excludes")}</p>
          <p>{t("telemetryConsent.changeLater")}</p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel
            className="w-full sm:w-auto"
            disabled={isSaving}
            onClick={() => void choose("declined")}
          >
            {t("telemetryConsent.decline")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="w-full sm:w-auto"
            disabled={isSaving}
            onClick={() => void choose("accepted")}
          >
            {t("telemetryConsent.accept")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
