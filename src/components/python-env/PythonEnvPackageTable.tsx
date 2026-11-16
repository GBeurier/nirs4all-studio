import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Lock } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  RecommendedPackageState,
  RequiredPackageState,
} from "@/types/pythonEnvironment";
import { groupByCategory, isSelectablePackage, type PackageListing } from "./pythonEnvModel";

interface PythonEnvPackageTableProps {
  report: PackageListing;
  selected: ReadonlySet<string>;
  onToggle: (name: string, checked: boolean) => void;
  disabled: boolean;
}

const cell = "px-3 py-1.5 align-middle";
const versionCell = cn(cell, "whitespace-nowrap font-mono text-xs");

function UpToDate() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
      {t("pythonEnv.packages.upToDate")}
    </span>
  );
}

function RequiredRow({ pkg, writable }: { pkg: RequiredPackageState; writable: boolean }) {
  const { t } = useTranslation();
  const changes = pkg.status === "missing" || pkg.status === "out_of_range";
  return (
    <tr className="border-b border-border/60">
      <td className={cn(cell, "w-9 pr-0")}>
        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </td>
      <td className={cell}>
        <span className="font-medium">{pkg.name}</span>
      </td>
      <td className={versionCell}>{pkg.installedVersion ?? "—"}</td>
      <td className={versionCell}>
        {changes && writable ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            {pkg.targetVersion}
          </span>
        ) : pkg.status === "ok" ? "—" : pkg.targetVersion}
      </td>
      <td className={cn(cell, "whitespace-nowrap text-xs")}>
        {pkg.status === "ok" ? (
          <UpToDate />
        ) : pkg.status === "editable" ? (
          <span className="text-destructive">{t("pythonEnv.packages.editable")}</span>
        ) : !writable ? (
          <span className="text-destructive">{t("pythonEnv.packages.cannotInstall")}</span>
        ) : (
          <span className="text-primary">
            {t(pkg.status === "missing" ? "pythonEnv.packages.autoInstall" : "pythonEnv.packages.autoUpdate")}
          </span>
        )}
      </td>
    </tr>
  );
}

function RecommendedRow({
  pkg,
  report,
  checked,
  onToggle,
  disabled,
}: {
  pkg: RecommendedPackageState;
  report: PackageListing;
  checked: boolean;
  onToggle: (name: string, checked: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const selectable = isSelectablePackage(pkg);
  const checkboxId = `python-env-package-${pkg.name}`;
  return (
    <tr className={cn("border-b border-border/60", checked && "bg-primary/5")}>
      <td className={cn(cell, "w-9 pr-0")}>
        <Checkbox
          id={checkboxId}
          checked={checked}
          disabled={disabled || !selectable || !report.writable}
          onCheckedChange={(value) => onToggle(pkg.name, value === true)}
        />
      </td>
      <td className={cell}>
        <label htmlFor={checkboxId} className="font-medium">{pkg.name}</label>
        <p className="truncate text-xs text-muted-foreground" title={pkg.description}>{pkg.description}</p>
      </td>
      <td className={versionCell}>{pkg.installedVersion ?? "—"}</td>
      <td className={versionCell}>{pkg.recommendedVersion}</td>
      <td className={cn(cell, "text-xs")}>
        {pkg.status === "ok" ? (
          <UpToDate />
        ) : pkg.status === "unsupported_python" ? (
          <span className="text-muted-foreground">
            {t("pythonEnv.packages.unsupportedPython", { version: report.pythonVersion })}
          </span>
        ) : pkg.status === "older" ? (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {t("pythonEnv.packages.update")}
            {pkg.belowMinimum && (
              <span className="block font-normal">{t("pythonEnv.packages.belowMinimum", { minimum: pkg.minimum })}</span>
            )}
          </span>
        ) : (
          <span className="font-medium">{t("pythonEnv.packages.install")}</span>
        )}
      </td>
    </tr>
  );
}

/** Required packages as locked rows, then the recommended catalogue by category. */
export function PythonEnvPackageTable({ report, selected, onToggle, disabled }: PythonEnvPackageTableProps) {
  const { t } = useTranslation();
  const groupHeader = "bg-muted/40 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-40" />
        </colgroup>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className={cell}><span className="sr-only">{t("pythonEnv.packages.columns.select")}</span></th>
            <th scope="col" className={cn(cell, "font-medium")}>{t("pythonEnv.packages.columns.package")}</th>
            <th scope="col" className={cn(cell, "font-medium")}>{t("pythonEnv.packages.columns.installed")}</th>
            <th scope="col" className={cn(cell, "font-medium")}>{t("pythonEnv.packages.columns.recommended")}</th>
            <th scope="col" className={cn(cell, "font-medium")}>{t("pythonEnv.packages.columns.action")}</th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child]:border-0">
          <tr className="border-b border-border/60">
            <th scope="colgroup" colSpan={5} className={groupHeader}>
              {t("pythonEnv.packages.required")}
              <span className="ml-2 font-normal normal-case tracking-normal">{t("pythonEnv.packages.requiredHint")}</span>
            </th>
          </tr>
          {report.required.map((pkg) => (
            <RequiredRow key={pkg.name} pkg={pkg} writable={report.writable} />
          ))}
          {groupByCategory(report.recommended).map(([category, packages]) => (
            <Fragment key={category}>
              <tr className="border-b border-border/60">
                <th scope="colgroup" colSpan={5} className={groupHeader}>
                  {t(`pythonEnv.categories.${category}`, { defaultValue: category })}
                </th>
              </tr>
              {packages.map((pkg) => (
                <RecommendedRow
                  key={pkg.name}
                  pkg={pkg}
                  report={report}
                  checked={selected.has(pkg.name)}
                  onToggle={onToggle}
                  disabled={disabled}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
