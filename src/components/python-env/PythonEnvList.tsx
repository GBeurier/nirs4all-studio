import { displayPath } from "@/lib/displayPath";
import { useTranslation } from "react-i18next";
import { FolderOpen, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PythonEnvReport } from "@/types/pythonEnvironment";
import { describeEnvironment, type EnvChipTone } from "./pythonEnvModel";

/** Radio value of the "create a new environment" choice. */
export const NEW_ENVIRONMENT = "new";

interface PythonEnvListProps {
  environments: PythonEnvReport[];
  currentPath: string | null;
  /** An interpreter path, `NEW_ENVIRONMENT`, or an empty string when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  detecting: boolean;
  disabled: boolean;
  /** Python version of the environment Studio would create, once known. */
  newPythonVersion: string | null;
  newDirectory: string | null;
  onChooseDirectory: () => void;
  onResetDirectory: () => void;
}

const chipTones: Record<EnvChipTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  problem: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

const row = "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-muted/50";
const rowSelected = "border-primary bg-primary/5 hover:bg-primary/5";

/** Environments found on this computer, each with what it lacks, plus the choice to create one. */
export function PythonEnvList({
  environments,
  currentPath,
  value,
  onChange,
  detecting,
  disabled,
  newPythonVersion,
  newDirectory,
  onChooseDirectory,
  onResetDirectory,
}: PythonEnvListProps) {
  const { t } = useTranslation();
  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      aria-label={t("pythonEnv.detected.title")}
      className="gap-2"
    >
      {environments.map((report) => (
        <label
          key={report.pythonPath}
          className={cn(row, value === report.pythonPath && rowSelected, disabled && "cursor-not-allowed opacity-70")}
        >
          <RadioGroupItem value={report.pythonPath} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">{t("pythonEnv.pythonVersion", { version: report.pythonVersion })}</span>
              <span className="text-muted-foreground">{t(`pythonEnv.kind.${report.kind}`)}</span>
              {report.pythonPath === currentPath && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">{t("pythonEnv.detected.current")}</Badge>
              )}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground" title={displayPath(report.pythonPath)}>{displayPath(report.pythonPath)}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("pythonEnv.detected.statusLabel")}>
              {describeEnvironment(report, t).map((chip) => (
                <li key={chip.id} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", chipTones[chip.tone])}>
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>
        </label>
      ))}

      {detecting && (
        <div role="status" className="space-y-2">
          <span className="sr-only">{t("pythonEnv.detected.detecting")}</span>
          <Skeleton className="h-[74px] w-full" />
          {environments.length === 0 && <Skeleton className="h-[74px] w-full" />}
        </div>
      )}

      {!detecting && environments.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t("pythonEnv.detected.none")}
        </p>
      )}

      <div className={cn("rounded-md border transition-colors", value === NEW_ENVIRONMENT ? "border-primary bg-primary/5" : "hover:bg-muted/50", disabled && "opacity-70")}>
        <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5", disabled && "cursor-not-allowed")}>
          <RadioGroupItem value={NEW_ENVIRONMENT} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("pythonEnv.create.title")}
              {newPythonVersion && (
                <span className="font-normal text-muted-foreground">{t("pythonEnv.pythonVersion", { version: newPythonVersion })}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("pythonEnv.create.description")}</p>
          </div>
        </label>
        {value === NEW_ENVIRONMENT && (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-10 text-xs">
            <span className="text-muted-foreground">{t("pythonEnv.create.location")}</span>
            <span className="min-w-0 truncate font-mono" title={newDirectory ?? undefined}>
              {newDirectory ?? t("pythonEnv.create.defaultLocation")}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-7" disabled={disabled} onClick={onChooseDirectory}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              {t("pythonEnv.create.chooseFolder")}
            </Button>
            {newDirectory && (
              <Button type="button" variant="ghost" size="sm" className="h-7" disabled={disabled} onClick={onResetDirectory}>
                {t("pythonEnv.create.useDefault")}
              </Button>
            )}
          </div>
        )}
      </div>
    </RadioGroup>
  );
}
