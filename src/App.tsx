import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { NirsSplashLoader } from "@/components/layout/NirsSplashLoader";
import { useMlReadiness } from "@/context/useMlReadiness";
import { TelemetryConsentDialog } from "@/components/privacy/TelemetryConsentDialog";
import { TRANSFER_ENABLED } from "@/lib/featureFlags";
import { useShapAvailable } from "@/hooks/useBackendCapabilities";
import { LoadingState } from "@/components/ui/state-display";

// Every page is split per route so the entry chunk only carries the shell.
const Datasets = lazy(() => import("@/pages/Datasets"));
const DatasetDetail = lazy(() => import("@/pages/DatasetDetail"));
const Pipelines = lazy(() => import("@/pages/Pipelines"));
const PipelineEditor = lazy(() => import("@/pages/PipelineEditor"));
const NewExperiment = lazy(() => import("@/pages/NewExperiment"));
const Playground = lazy(() => import("@/pages/Playground"));
const Inspector = lazy(() => import("@/pages/Inspector"));
const Runs = lazy(() => import("@/pages/Runs"));
const RunProgress = lazy(() => import("@/pages/RunProgress"));
const Results = lazy(() => import("@/pages/Results"));
const AggregatedResults = lazy(() => import("@/pages/AggregatedResults"));
const Predict = lazy(() => import("@/pages/Predict"));
const Predictions = lazy(() => import("@/pages/Predictions"));
const Lab = lazy(() => import("@/pages/Lab"));
const SpectraSynthesis = lazy(() => import("@/pages/SpectraSynthesis"));
const TransferAnalysis = lazy(() => import("@/pages/TransferAnalysis"));
const VariableImportance = lazy(() => import("@/pages/VariableImportance"));
const Settings = lazy(() => import("@/pages/Settings"));
const SetupWizard = lazy(() => import("@/pages/SetupWizard"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const electronApi = (window as unknown as {
  electronApi?: {
    isElectron: boolean;
  };
}).electronApi;

const backendMessages = [
  "Starting Studio...",
  "Please wait while Studio starts...",
];


function BackendConnectingScreen() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const idxRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function pickNext() {
      let idx;
      do { idx = Math.floor(Math.random() * backendMessages.length); } while (idx === idxRef.current);
      idxRef.current = idx;
      return backendMessages[idx];
    }
    function cycle() {
      setText(pickNext());
      setVisible(true);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        timerRef.current = setTimeout(cycle, 450);
      }, 3500);
    }
    const startDelay = setTimeout(cycle, 800);
    return () => {
      clearTimeout(startDelay);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen" style={{ background: "#ffffff" }}>
      <style>{`
        .splash-char {
          opacity: 0;
          display: inline-block;
          animation: splashCharReveal 0.25s ease forwards;
        }
        @keyframes splashCharReveal {
          0% { opacity: 0; text-shadow: 0 0 8px rgb(37, 119, 187); }
          40% { opacity: 1; text-shadow: 0 0 4px rgb(37, 119, 187); }
          60% { opacity: 0.4; }
          80% { opacity: 0.85; text-shadow: none; }
          100% { opacity: 0.65; }
        }
      `}</style>
      <img src={`${import.meta.env.BASE_URL}nirs4all_logo.png`} alt="nirs4all" draggable={false} className="w-[200px] h-auto mb-1.5 select-none pointer-events-none" />
      <h1 className="text-[28px] font-semibold -tracking-wide mb-1" style={{ color: "#18181b" }}>Studio</h1>
      <p className="text-[13px] uppercase tracking-[2px] mb-5" style={{ color: "#a1a1aa" }}>
        Build {"\u00B7"} Explore {"\u00B7"} Predict
      </p>
      <NirsSplashLoader className="w-[340px] h-[90px]" />
      <p
        className={`mt-4 font-mono text-[11px] min-h-[16px] transition-opacity [transition-duration:400ms] ${visible ? "opacity-100" : "opacity-0"}`}
        style={{ color: "#94a3b8" }}
      >
        {text.split("").map((char, i) => (
          <span key={`${idxRef.current}-${i}`} className="splash-char" style={{ animationDelay: `${i * 25}ms` }}>
            {char === " " ? "\u00A0" : char}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * `/lab/shapley` requires `shap` in the backend (absent in lite builds).
 * Mirrors the Transfer route guard: redirect to /lab when unavailable.
 */
function ShapleyRoute() {
  const shapAvailable = useShapAvailable();
  return shapAvailable ? <VariableImportance /> : <Navigate to="/lab" replace />;
}

/** Keeps the sidebar/layout mounted while a lazily loaded page chunk is fetched. */
function PageSuspense() {
  return (
    <Suspense fallback={<LoadingState className="border-0 shadow-none" />}>
      <Outlet />
    </Suspense>
  );
}

function App() {
  const { controlReady } = useMlReadiness();
  const isElectron = !!electronApi?.isElectron;
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  useEffect(() => {
    if (controlReady) {
      setHasConnectedOnce(true);
    }
  }, [controlReady]);

  // Backend not yet reachable — show connecting screen
  // (only in Electron; in web mode, Vite proxy handles backend connectivity)
  // After the first successful connection, keep the app chrome mounted and let
  // BackendStartupBanner communicate transient backend restarts/non-ready states.
  if (isElectron && !controlReady && !hasConnectedOnce) {
    return (
      <>
        <BackendConnectingScreen />
        <TelemetryConsentDialog />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route element={<PageSuspense />}>
            <Route index element={<Navigate to="/datasets" replace />} />
            <Route path="datasets" element={<Datasets />} />
            <Route path="datasets/:id" element={<DatasetDetail />} />
            <Route path="pipelines" element={<Pipelines />} />
            <Route path="pipelines/:id" element={<PipelineEditor />} />
            <Route path="pipelines/new" element={<PipelineEditor />} />
            <Route path="editor" element={<NewExperiment />} />
            <Route path="playground" element={<Playground />} />
            <Route path="inspector" element={<Inspector />} />
            <Route path="runs" element={<Runs />} />
            <Route path="runs/:id" element={<RunProgress />} />
            <Route path="results" element={<Results />} />
            <Route path="results/aggregated" element={<AggregatedResults />} />
            <Route path="predict" element={<Predict />} />
            <Route path="predictions" element={<Predictions />} />
            <Route path="lab" element={<Lab />}>
              <Route index element={<Navigate to="/lab/synthesis" replace />} />
              <Route path="synthesis" element={<SpectraSynthesis />} />
              <Route path="transfer" element={TRANSFER_ENABLED ? <TransferAnalysis /> : <Navigate to="/lab" replace />} />
              <Route path="shapley" element={<ShapleyRoute />} />
            </Route>
            <Route path="settings" element={<Settings />} />
            <Route path="setup" element={<SetupWizard />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
      <TelemetryConsentDialog />
    </>
  );
}

export default App;
