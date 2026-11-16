import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstallLogSnapshot } from "@/types/installLog";
import { Button } from "@/components/ui/button";
import { getActiveLocale } from "@/lib/activeLocale";

/** One bounded history per process, owned by the desktop shell; remounts replay it. */
export function InstallationLogPanel({ active = false, error }: {
  active?: boolean;
  /** Failure shown by the caller; it opens the details and is copied with the log. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<InstallLogSnapshot>();
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const desktop = window.electronApi;
    void desktop?.getInstallLog?.().then(setSnapshot).catch(() => {});
    return desktop?.onInstallLog?.(setSnapshot);
  }, []);
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
      <summary className="cursor-pointer font-medium">{t("pythonEnv.log.summary")}</summary>
      <p role="status" className="my-2 text-muted-foreground">
        {failed ? t("pythonEnv.log.failed") : running ? t("pythonEnv.log.inProgress", { seconds: elapsed }) : snapshot?.status === "complete" ? t("pythonEnv.log.completed") : t("pythonEnv.log.none")}
        {running && age >= 10 ? t("pythonEnv.log.noNewOutput", { seconds: age }) : ""}
      </p>
      <pre ref={output} aria-label={t("pythonEnv.log.log")} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
        onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24; }}>
        {text || t("pythonEnv.log.waiting")}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText([text, error].filter(Boolean).join("\n")); setCopyMessage(t("pythonEnv.log.copied")); }
          catch { setCopyMessage(t("pythonEnv.log.copyUnavailable")); }
        }}>{t("pythonEnv.log.copy")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          following.current = true;
          if (output.current) output.current.scrollTop = output.current.scrollHeight;
        }}>{t("pythonEnv.log.follow")}</Button>
        <span role="status">{copyMessage}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("pythonEnv.log.retention")}</p>
    </details>
  );
}
