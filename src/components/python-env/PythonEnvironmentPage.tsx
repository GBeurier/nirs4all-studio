/**
 * The single Python environment page, shared by the `/setup` route and the
 * Settings "Python" tab: current environment, environments found on this
 * computer, package choices and one action.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { InstallationLogPanel } from "@/components/setup/InstallationLogPanel";
import { usePythonEnv } from "@/context/usePythonEnv";
import type {
  NewPythonEnvPlan,
  PythonEnvApi,
  PythonEnvReport,
  PythonEnvState,
} from "@/types/pythonEnvironment";
import { PythonEnvDeploymentSummary } from "./PythonEnvDeploymentSummary";
import { NEW_ENVIRONMENT, PythonEnvList } from "./PythonEnvList";
import { PythonEnvPackageTable } from "./PythonEnvPackageTable";
import {
  initialPackageSelection,
  isSelectablePackage,
  packageListing,
  primaryActionKind,
  type EnvTarget,
} from "./pythonEnvModel";

type PageContext = "setup" | "settings";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PythonEnvironmentPage({ context }: { context: PageContext }) {
  const { api } = usePythonEnv();
  return api ? <DesktopPythonEnvironment api={api} context={context} /> : <PythonEnvDeploymentSummary />;
}

function CurrentEnvironment({
  state,
  busy,
  onRetry,
}: {
  state: PythonEnvState | null;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const report = state?.selected ?? null;
  const path = report?.pythonPath ?? state?.selectedPythonPath ?? null;
  const outdated = report?.outdatedRecommendedCount ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {t("pythonEnv.current.title")}
        </CardTitle>
        <CardDescription>{t("pythonEnv.current.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!state ? (
          <div className="space-y-2" role="status" aria-label={t("pythonEnv.current.loading")}>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        ) : !path ? (
          <p className="text-sm text-muted-foreground">{t("pythonEnv.current.none")}</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {report && (
              <>
                <dt className="text-muted-foreground">{t("pythonEnv.current.python")}</dt>
                <dd>{report.pythonVersion} · {t(`pythonEnv.kind.${report.kind}`)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("pythonEnv.current.path")}</dt>
            <dd className="truncate font-mono text-xs leading-5" title={path}>{path}</dd>
          </dl>
        )}

        {state?.phase === "ready" && (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
            {t("pythonEnv.current.ready")}
            {outdated > 0 && (
              <span className="text-amber-700 dark:text-amber-400">· {t("pythonEnv.outdated", { count: outdated })}</span>
            )}
          </p>
        )}
        {state?.phase === "busy" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t(`pythonEnv.activity.${state.activity?.kind ?? "installing"}`)}
          </p>
        )}
        {state?.problem && (state.phase === "needs_attention" || state.phase === "unconfigured") && (
          <Alert className="border-amber-300 text-amber-950 dark:border-amber-900 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <AlertTitle>{t(`pythonEnv.problem.${state.problem.code}`)}</AlertTitle>
                {state.problem.message && (
                  <AlertDescription className="break-words">{state.problem.message}</AlertDescription>
                )}
              </div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRetry}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t("common.retry")}
              </Button>
            </div>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function DesktopPythonEnvironment({ api, context }: { api: PythonEnvApi; context: PageContext }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, run, skipSetup } = usePythonEnv();

  const [detected, setDetected] = useState<PythonEnvReport[]>([]);
  const [browsed, setBrowsed] = useState<PythonEnvReport[]>([]);
  const [newPlan, setNewPlan] = useState<NewPythonEnvPlan | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  /** Interpreter path, `NEW_ENVIRONMENT`, or empty for the current environment. */
  const [choice, setChoice] = useState("");
  const [newDirectory, setNewDirectory] = useState<string | null>(null);
  /** Packages ticked by the user for one choice; until then the choice's defaults apply. */
  const [ticks, setTicks] = useState<{ choice: string; names: ReadonlySet<string> } | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const detect = useCallback(async (refresh: boolean) => {
    setDetecting(true);
    setDetectionError(null);
    try {
      setDetected(await api.detect(refresh));
    } catch (error) {
      setDetectionError(errorMessage(error));
    } finally {
      setDetecting(false);
    }
  }, [api]);

  const [planError, setPlanError] = useState<string | null>(null);
  const describeNew = useCallback(async () => {
    setPlanError(null);
    try {
      setNewPlan(await api.describeNewEnvironment());
    } catch (error) {
      setPlanError(errorMessage(error));
    }
  }, [api]);

  useEffect(() => {
    void detect(false);
    void describeNew();
  }, [detect, describeNew]);

  const current = state?.selected ?? null;
  const environments = useMemo(() => {
    const seen = new Set<string>();
    return [...(current ? [current] : []), ...browsed, ...detected].filter((report) => {
      if (seen.has(report.pythonPath)) return false;
      seen.add(report.pythonPath);
      return true;
    });
  }, [current, browsed, detected]);

  // A first launch on a computer without Python has one way forward.
  const nothingFound = !detecting && !detectionError && environments.length === 0 && state?.phase === "unconfigured";
  useEffect(() => {
    if (nothingFound) setChoice((value) => value || NEW_ENVIRONMENT);
  }, [nothingFound]);

  const target = useMemo<EnvTarget | null>(() => {
    if (choice === NEW_ENVIRONMENT) return { type: "new", plan: newPlan };
    const picked = environments.find((report) => report.pythonPath === choice);
    if (picked && picked.pythonPath !== current?.pythonPath) return { type: "existing", report: picked };
    return current ? { type: "current", report: current } : null;
  }, [choice, newPlan, environments, current]);

  const selected = useMemo<ReadonlySet<string>>(
    () => (ticks?.choice === choice ? ticks.names : new Set(initialPackageSelection(target))),
    [ticks, choice, target],
  );

  const report = packageListing(target);
  const awaitingPlan = target?.type === "new" && !target.plan;
  const packages = report
    ? report.recommended.filter((pkg) => selected.has(pkg.name) && isSelectablePackage(pkg)).map((pkg) => pkg.name)
    : [];
  const busy = working || state?.phase === "busy";
  const action = primaryActionKind(target, packages.length);
  const ready = state?.phase === "ready";
  const opensStudio = context === "setup" && ready && action === "nothing";

  const perform = async (start: Parameters<typeof run>[0]) => {
    setWorking(true);
    setFailure(null);
    let succeeded = false;
    try {
      const result = await run(start);
      succeeded = result.success;
      if (!result.success) setFailure(result.message ?? t("pythonEnv.action.failed"));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setWorking(false);
    }
    // A failed creation may have left an environment behind: creating again
    // would collide with it, so that choice is made anew from a fresh listing.
    if (succeeded || choice === NEW_ENVIRONMENT) {
      setChoice("");
      setTicks(null);
    }
    void detect(true);
  };

  const submit = () => {
    if (!target) return;
    if (target.type === "new") {
      void perform((env) => env.create(newDirectory ? { directory: newDirectory, packages } : { packages }));
    } else if (target.type === "existing") {
      void perform((env) => env.apply({ pythonPath: target.report.pythonPath, packages }));
    } else {
      void perform((env) => env.installPackages(packages));
    }
  };

  const browse = async () => {
    setBrowseError(null);
    try {
      const path = await api.browse();
      if (!path) return;
      const inspected = await api.inspect(path);
      if (!inspected.report) {
        setBrowseError(inspected.error ?? t("pythonEnv.detected.browseFailed"));
        return;
      }
      const found = inspected.report;
      setBrowsed((previous) => [found, ...previous.filter((item) => item.pythonPath !== found.pythonPath)]);
      setTicks(null);
      setChoice(found.pythonPath === current?.pythonPath ? "" : found.pythonPath);
    } catch (error) {
      setBrowseError(errorMessage(error));
    }
  };

  const chooseDirectory = async () => {
    const directory = await api.chooseDirectory();
    if (directory) setNewDirectory(directory);
  };

  const openStudio = () => navigate("/datasets", { replace: true });

  const actionLabel = opensStudio
    ? t("pythonEnv.setup.open")
    : action === "create" ? t("pythonEnv.action.create")
    : action === "installAndUse" ? t("pythonEnv.action.installAndUse", { count: packages.length })
    : action === "install" ? t("pythonEnv.action.install", { count: packages.length })
    : action === "nothing" ? t("pythonEnv.action.installNone")
    : action === "choose" ? t("pythonEnv.action.choose")
    : t("pythonEnv.action.use");

  const requiredPending = report?.required.some((pkg) => pkg.status !== "ok") ?? false;
  const summary = opensStudio ? t("pythonEnv.setup.ready")
    : action === "choose" ? t("pythonEnv.summary.choose")
    : action === "blocked" ? t(report?.writable ? "pythonEnv.summary.blockedEditable" : "pythonEnv.summary.blockedReadOnly")
    : action === "create" ? t("pythonEnv.summary.create")
    : action === "nothing"
      ? t(!report?.writable ? "pythonEnv.summary.readOnly"
        : report.recommended.some(isSelectablePackage) ? "pythonEnv.summary.select" : "pythonEnv.summary.upToDate")
    : action === "install" ? t("pythonEnv.summary.install")
    : t(requiredPending ? "pythonEnv.summary.useAndPrepare" : "pythonEnv.summary.use");

  return (
    <div className="space-y-6">
      {context === "setup" && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("pythonEnv.setup.title")}</h1>
            <p className="max-w-2xl text-muted-foreground">{t("pythonEnv.setup.description")}</p>
          </div>
          {ready ? (
            <Button type="button" onClick={openStudio}>{t("pythonEnv.setup.open")}</Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                skipSetup();
                openStudio();
              }}
            >
              {t("pythonEnv.setup.skip")}
            </Button>
          )}
        </div>
      )}

      <CurrentEnvironment state={state} busy={busy} onRetry={() => void perform((env) => env.retry())} />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                {t("pythonEnv.detected.title")}
              </CardTitle>
              <CardDescription>{t("pythonEnv.detected.description")}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={detecting || busy}
              onClick={() => {
                void detect(true);
                if (!newPlan) void describeNew();
              }}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
              {t("common.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {detectionError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("pythonEnv.detected.failed")}</AlertTitle>
              <AlertDescription className="break-words">{detectionError}</AlertDescription>
            </Alert>
          )}
          <PythonEnvList
            environments={environments}
            currentPath={current?.pythonPath ?? null}
            value={choice || current?.pythonPath || ""}
            onChange={(value) => {
              setFailure(null);
              setTicks(null);
              setChoice(value === current?.pythonPath ? "" : value);
            }}
            detecting={detecting}
            disabled={busy}
            newPythonVersion={newPlan?.pythonVersion ?? null}
            newDirectory={newDirectory}
            onChooseDirectory={() => void chooseDirectory()}
            onResetDirectory={() => setNewDirectory(null)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void browse()}>
              <FileSearch className="mr-2 h-4 w-4" />
              {t("pythonEnv.detected.browse")}
            </Button>
            {browseError && <p role="alert" className="min-w-0 break-words text-sm text-destructive">{browseError}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("pythonEnv.packages.title")}
          </CardTitle>
          <CardDescription>
            {target?.type === "new" ? t("pythonEnv.packages.forNew")
              : target?.type === "existing" ? t("pythonEnv.packages.forPending", { path: target.report.pythonPath })
              : target ? t("pythonEnv.packages.forCurrent")
              : t("pythonEnv.packages.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-3 px-6 pb-4">
            {report && !report.writable && (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                {t("pythonEnv.packages.readOnly")}
              </p>
            )}
            {report ? (
              <PythonEnvPackageTable
                report={report}
                selected={selected}
                disabled={busy}
                onToggle={(name, checked) => {
                  const names = new Set(selected);
                  if (checked) names.add(name); else names.delete(name);
                  setTicks({ choice, names });
                }}
              />
            ) : awaitingPlan && planError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("pythonEnv.packages.planFailed")}</AlertTitle>
                <AlertDescription className="break-words">{planError}</AlertDescription>
              </Alert>
            ) : awaitingPlan ? (
              <div className="space-y-2" role="status" aria-label={t("pythonEnv.packages.loadingPlan")}>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {t("pythonEnv.packages.empty")}
              </p>
            )}

            {failure && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("pythonEnv.action.failedTitle")}</AlertTitle>
                <AlertDescription className="break-words">{failure}</AlertDescription>
              </Alert>
            )}
            {(busy || failure) && <InstallationLogPanel active={busy} error={failure} />}
          </div>

          {/* Stays reachable under the long package list; the offsets cancel the page padding. */}
          <div className="sticky -bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-card px-6 py-3 md:-bottom-6">
            {state?.phase === "busy" ? (
              <div className="min-w-0 flex-1 space-y-1.5" role="status" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t(`pythonEnv.activity.${state.activity?.kind ?? "installing"}`)}
                  {typeof state.activity?.percent === "number" && (
                    <span className="font-normal text-muted-foreground">{Math.round(state.activity.percent)}%</span>
                  )}
                </p>
                {typeof state.activity?.percent === "number" ? (
                  <Progress value={state.activity.percent} aria-label={t(`pythonEnv.activity.${state.activity.kind}`)} />
                ) : (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                  </div>
                )}
                {state.activity?.detail && (
                  <p className="truncate text-xs text-muted-foreground" title={state.activity.detail}>{state.activity.detail}</p>
                )}
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">{summary}</p>
            )}
            {state?.phase !== "busy" && (
              <Button
                type="button"
                disabled={busy || awaitingPlan || (!opensStudio && (action === "choose" || action === "blocked" || action === "nothing"))}
                onClick={opensStudio ? openStudio : submit}
              >
                {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {actionLabel}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
