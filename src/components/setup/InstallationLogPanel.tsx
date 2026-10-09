import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api/transport";
import type { InstallLogSnapshot } from "@/types/installLog";
import { Button } from "@/components/ui/button";
import { getActiveLocale } from "@/lib/activeLocale";

/** One bounded history per process; remounts replay it without restarting installation. */
export function InstallationLogPanel({ active = false, backendEnabled = true, error }: {
  active?: boolean; backendEnabled?: boolean; error?: string | null;
}) {
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<InstallLogSnapshot>();
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const history = useQuery({
    queryKey: ["installation-log"],
    queryFn: () => api.get<InstallLogSnapshot>("/config/install-log"),
    enabled: backendEnabled,
    retry: false,
    staleTime: 500,
    refetchInterval: (query) => active || query.state.data?.status === "running" ? 1000 : false,
  });
  useEffect(() => {
    const desktop = window.electronApi;
    void desktop?.getInstallLog?.().then(setBootstrap).catch(() => {});
    return desktop?.onInstallLog?.(setBootstrap);
  }, []);
  const snapshot = (bootstrap?.updated_at ?? 0) > (history.data?.updated_at ?? 0) ? bootstrap : history.data;
  const running = !error && (active || snapshot?.status === "running");
  const failed = Boolean(error) || (!active && snapshot?.status === "error");
  useEffect(() => { if (failed) setOpen(true); }, [failed]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (following.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [snapshot, open]);
  const lines = snapshot?.lines ?? [];
  const text = lines.map(line => `${new Date(line.time).toLocaleTimeString(getActiveLocale())} ${line.text}`).join("\n");
  const elapsed = snapshot?.started_at ? Math.max(0, Math.floor((now - snapshot.started_at) / 1000)) : 0;
  const age = snapshot?.updated_at ? Math.max(0, Math.floor((now - snapshot.updated_at) / 1000)) : 0;
  return (
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-md border p-3 text-sm my-3">
      <summary className="cursor-pointer font-medium">{t("setupWizard.installLog.summary")}</summary>
      <p role="status" className="my-2 text-muted-foreground">
        {failed ? t("setupWizard.installLog.failed") : running ? t("setupWizard.installLog.inProgress", { seconds: elapsed }) : snapshot?.status === "complete" ? t("setupWizard.installLog.completed") : t("setupWizard.installLog.none")}
        {running && age >= 10 ? t("setupWizard.installLog.noNewOutput", { seconds: age }) : ""}
      </p>
      {backendEnabled && history.isError && <p role="alert">{t("setupWizard.installLog.unavailable")}</p>}
      {error && <p role="alert" className="text-destructive break-words">{error}</p>}
      <pre ref={output} aria-label={t("setupWizard.installLog.log")} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
        onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24; }}>
        {text || t("setupWizard.installLog.waiting")}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText([text, error].filter(Boolean).join("\n")); setCopyMessage(t("setupWizard.installLog.copied")); }
          catch { setCopyMessage(t("setupWizard.installLog.copyUnavailable")); }
        }}>{t("setupWizard.installLog.copy")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          following.current = true;
          if (output.current) output.current.scrollTop = output.current.scrollHeight;
        }}>{t("setupWizard.installLog.follow")}</Button>
        <span role="status">{copyMessage}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("setupWizard.installLog.retention")}</p>
    </details>
  );
}
