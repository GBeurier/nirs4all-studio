import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMlReadiness } from "@/context/MlReadinessContext";
import { datasetQueryKeys } from "@/hooks/useDatasetQueries";
import { Progress } from "@/components/ui/progress";
import { NirsSplashLoader } from "./NirsSplashLoader";

// Minimum time the banner stays visible after mount. Without this, a fast
// Electron start (ML already warm, workspace tiny) flips readiness in the
// same frame AppLayout mounts and the banner disappears before the user can
// perceive it.
const MIN_VISIBLE_MS = 1500;

type StartupStepState = "done" | "loading" | "waiting" | "error";

interface StartupStep {
  label: string;
  detail: string;
  state: StartupStepState;
}

function StepIcon({ state }: { state: StartupStepState }) {
  if (state === "done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  }
  if (state === "error") {
    return <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  }
  if (state === "loading") {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />;
  }
  return <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />;
}

function StepCard({ label, detail, state }: StartupStep) {
  const tone =
    state === "error"
      ? "border-destructive/30 bg-destructive/5"
      : state === "done"
        ? "border-emerald-500/30 bg-emerald-500/5"
        : state === "loading"
          ? "border-primary/25 bg-primary/5"
          : "border-border/60 bg-muted/30";

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${tone}`}>
      <div className="mt-0.5 shrink-0">
        <StepIcon state={state} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-sm text-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

export function BackendStartupBanner() {
  const { t } = useTranslation();
  const { coreReady, mlReady, workspaceReady, datasetsPrimed, mlError } =
    useMlReadiness();

  // Live fetch counters for the two queries that drive the Datasets landing
  // page. React Query increments these as soon as a fetch starts and
  // decrements when it settles, so they track the post-workspace refetch
  // window that used to leave only the in-card spinner visible.
  const fetchingDatasets = useIsFetching({ queryKey: datasetQueryKeys.list() });
  const fetchingWorkspaces = useIsFetching({
    queryKey: datasetQueryKeys.linkedWorkspaces(),
  });

  const [minVisibleElapsed, setMinVisibleElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinVisibleElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  // One-way latch: once startup is fully quiet (backend ready + caches primed
  // + nothing fetching), the banner stays hidden for the rest of the session.
  // This stops routine background refetches (user-initiated refresh, focus
  // revalidation) from re-showing the banner after the initial startup.
  const [hasSettled, setHasSettled] = useState(false);
  useEffect(() => {
    if (hasSettled) return;
    if (
      workspaceReady &&
      datasetsPrimed &&
      fetchingDatasets === 0 &&
      fetchingWorkspaces === 0
    ) {
      setHasSettled(true);
    }
  }, [
    hasSettled,
    workspaceReady,
    datasetsPrimed,
    fetchingDatasets,
    fetchingWorkspaces,
  ]);

  if (hasSettled && minVisibleElapsed) {
    return null;
  }

  const workspacePhase =
    !workspaceReady ||
    !datasetsPrimed ||
    fetchingDatasets > 0 ||
    fetchingWorkspaces > 0;
  const workspaceDone = !workspacePhase;

  const title = !coreReady
    ? t("layout.backendStartup.connectingTitle", "Connecting to backend...")
    : mlError
      ? t("layout.backendStartup.errorTitle", "Backend startup stalled")
      : !mlReady
        ? t("layout.backendStartup.loadingTitle", "Loading analysis backend...")
        : t("layout.backendStartup.workspaceTitle", "Loading workspace...");

  const description = !coreReady
    ? t(
        "layout.backendStartup.connectingDescription",
        "The backend is still starting. Cached content may appear first, but actions stay limited until the API responds."
      )
    : mlError
      ? mlError
      : !mlReady
        ? t(
            "layout.backendStartup.loadingDescription",
            "nirs4all and its ML dependencies are initializing in the background. Heavy analysis features will unlock automatically."
          )
        : t(
            "layout.backendStartup.workspaceDescription",
          "The backend is loading the active workspace. Dataset, run, result, and prediction views will refresh when startup finishes."
          );

  const progressValue = !coreReady ? 18 : !mlReady ? 52 : workspaceDone ? 100 : 84;
  const badgeLabel = mlError
    ? t("layout.backendStartup.errorBadge", "Startup issue")
    : t("layout.backendStartup.badge", "Backend loading");

  const steps: StartupStep[] = [
    {
      label: t("layout.backendStartup.apiLabel", "API"),
      detail: coreReady
        ? t("layout.backendStartup.apiReady", "Connected")
        : t("layout.backendStartup.apiLoading", "Starting FastAPI"),
      state: coreReady ? "done" : "loading",
    },
    {
      label: t("layout.backendStartup.mlLabel", "ML Engine"),
      detail: mlError
        ? t("layout.backendStartup.mlError", "Initialization failed")
        : mlReady
          ? t("layout.backendStartup.mlReady", "Dependencies loaded")
          : coreReady
            ? t("layout.backendStartup.mlLoading", "Importing nirs4all and sklearn")
            : t("layout.backendStartup.mlWaiting", "Waiting for API"),
      state: mlError ? "error" : mlReady ? "done" : coreReady ? "loading" : "waiting",
    },
    {
      label: t("layout.backendStartup.workspaceLabel", "Workspace"),
      detail: mlError
        ? t("layout.backendStartup.workspaceBlocked", "Blocked until backend recovers")
        : workspaceDone
          ? t("layout.backendStartup.workspaceReady", "Ready")
          : mlReady
            ? t("layout.backendStartup.workspaceLoading", "Loading datasets and run state")
            : t("layout.backendStartup.workspaceWaiting", "Queued behind ML startup"),
      state: mlError
        ? "error"
        : workspaceDone
          ? "done"
          : mlReady
            ? "loading"
            : "waiting",
    },
  ];

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={workspacePhase}
      className="shrink-0 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-2xl border border-primary/15 bg-card/90 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="hidden rounded-xl bg-primary/5 p-2 sm:block">
              <NirsSplashLoader className="h-8 w-16" alt={t("layout.backendStartup.loaderAlt", "Backend loading animation")} />
            </div>
          <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary md:self-center">
            {mlError ? (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            <span>{badgeLabel}</span>
          </div>
        </div>

        <Progress value={progressValue} className="h-1.5 bg-primary/10" />

        <div className="grid gap-2 lg:grid-cols-3">
          {steps.map((step) => (
            <StepCard key={step.label} {...step} />
          ))}
        </div>
      </div>
    </section>
  );
}
