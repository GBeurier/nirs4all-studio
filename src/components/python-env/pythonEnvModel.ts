/** Pure view logic of the Python environment page. */
import type { TFunction } from "i18next";
import type {
  NewPythonEnvPlan,
  PythonEnvReport,
  RecommendedPackageState,
} from "@/types/pythonEnvironment";

export type EnvChipTone = "ok" | "info" | "warning" | "problem" | "neutral";

export interface EnvChip {
  id: string;
  tone: EnvChipTone;
  label: string;
}

/** What Studio is about to act on: the selected environment, another one, or a new one. */
export type EnvTarget =
  | { type: "current"; report: PythonEnvReport }
  | { type: "existing"; report: PythonEnvReport }
  /** `plan` is null until the main process has described the new environment. */
  | { type: "new"; plan: NewPythonEnvPlan | null };

/** The packages of a target: an environment's report, or the plan of a new environment. */
export type PackageListing = Pick<PythonEnvReport, "pythonVersion" | "writable" | "required" | "recommended">;

export function packageListing(target: EnvTarget | null): PackageListing | null {
  if (!target) return null;
  if (target.type !== "new") return target.report;
  return target.plan ? { ...target.plan, writable: true } : null;
}

export type PrimaryActionKind = "choose" | "blocked" | "create" | "use" | "installAndUse" | "install" | "nothing";

/** The library users know; its change is named, other required packages are counted. */
const LEAD_REQUIRED_PACKAGE = "nirs4all";

/**
 * Studio can prepare an environment when its required packages are already in
 * range, or when it may install them: writable and no editable install to keep.
 */
export function canUseEnvironment(report: PythonEnvReport): boolean {
  return report.usable
    || (report.writable && report.required.every((pkg) => pkg.status !== "editable"));
}

/** Compact "what is missing" summary of one environment, from its package listing. */
export function describeEnvironment(report: PythonEnvReport, t: TFunction): EnvChip[] {
  const chips: EnvChip[] = [];
  const pending = report.required.filter((pkg) => pkg.status !== "ok");
  const installable = report.writable;

  if (report.usable) {
    chips.push({ id: "ready", tone: "ok", label: t("pythonEnv.chips.ready") });
  }
  for (const pkg of pending.filter((candidate) => candidate.status === "editable")) {
    chips.push({
      id: `editable:${pkg.name}`,
      tone: "problem",
      label: t("pythonEnv.chips.editable", { name: pkg.name, version: pkg.installedVersion ?? "" }),
    });
  }
  const changes = pending.filter((pkg) => pkg.status !== "editable");
  const lead = changes.find((pkg) => pkg.name === LEAD_REQUIRED_PACKAGE);
  if (lead) {
    const missing = lead.status === "missing" || lead.installedVersion === null;
    chips.push({
      id: "required",
      tone: installable ? "info" : "problem",
      label: missing
        ? t(installable ? "pythonEnv.chips.willInstall" : "pythonEnv.chips.missing", { name: lead.name })
        : installable
          ? t("pythonEnv.chips.willUpdate", { name: lead.name, from: lead.installedVersion, to: lead.targetVersion })
          : t("pythonEnv.chips.unsupported", { name: lead.name, version: lead.installedVersion }),
    });
  } else if (changes.length > 0) {
    chips.push({
      id: "required",
      tone: installable ? "info" : "problem",
      label: t(installable ? "pythonEnv.chips.requiredWillUpdate" : "pythonEnv.chips.requiredUnsupported", { count: changes.length }),
    });
  }

  const recommendedMissing = report.recommended.filter((pkg) => pkg.status === "missing").length;
  if (recommendedMissing > 0) {
    chips.push({ id: "recommended-missing", tone: "neutral", label: t("pythonEnv.chips.recommendedMissing", { count: recommendedMissing }) });
  }
  if (report.outdatedRecommendedCount > 0) {
    chips.push({ id: "recommended-older", tone: "warning", label: t("pythonEnv.chips.recommendedOlder", { count: report.outdatedRecommendedCount }) });
  }
  if (!report.writable) {
    chips.push({ id: "read-only", tone: "neutral", label: t("pythonEnv.chips.readOnly") });
  }
  return chips;
}

/** A recommended package Studio can install or update on request. */
export function isSelectablePackage(pkg: RecommendedPackageState): boolean {
  return pkg.status === "missing" || pkg.status === "older";
}

/** A new environment starts with the default packages; an existing one is left as it is. */
export function initialPackageSelection(target: EnvTarget | null): string[] {
  if (target?.type !== "new" || !target.plan) return [];
  return target.plan.recommended
    .filter((pkg) => pkg.defaultInstall && isSelectablePackage(pkg))
    .map((pkg) => pkg.name);
}

export function groupByCategory(packages: RecommendedPackageState[]): [string, RecommendedPackageState[]][] {
  const groups = new Map<string, RecommendedPackageState[]>();
  for (const pkg of packages) {
    groups.set(pkg.category, [...(groups.get(pkg.category) ?? []), pkg]);
  }
  return [...groups.entries()];
}

export function primaryActionKind(target: EnvTarget | null, packageCount: number): PrimaryActionKind {
  if (!target) return "choose";
  if (target.type === "new") return "create";
  if (target.type === "existing") {
    if (!canUseEnvironment(target.report)) return "blocked";
    return packageCount > 0 ? "installAndUse" : "use";
  }
  return packageCount > 0 ? "install" : "nothing";
}
